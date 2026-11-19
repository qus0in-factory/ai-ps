import type { Result } from '../domain/chat.ts';
import { pcm16ToWav } from '../domain/talk/audio.ts';
import { MAX_TTS_TEXT_LENGTH, type AudioClip, type Speaker } from '../domain/talk/speech-cache.ts';
import { createOpenAIClient, type OpenAIClient } from './openai.ts';

export const REALTIME_SPEECH_PROMPT_VERSION = 'ja-read-v1';
const INSTRUCTIONS = '入力された日本語の文章を、そのまま読み上げてください。親切な日本語教師のように、はっきりと適度な速さで話してください。質問に答えたり、言葉を加えたり、翻訳したりしないでください。';
const MAX_WAV_BYTES = 2 * 1024 * 1024;

export interface RealtimeSocket extends EventTarget {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  accept?(): void;
}
export type RealtimeConnect = (url: string, headers: Record<string, string>, signal: AbortSignal) => RealtimeSocket | Promise<RealtimeSocket>;
export interface SpeechWarning {
  event: 'tts_transcript_length_mismatch'; inputLength: number; outputLength: number;
}

/** Workers upgrade transport; Node callers inject a header-capable WebSocket connector. */
export const connectWorkers: RealtimeConnect = async (url, headers, signal) => {
  const response = await fetch(url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), {
    headers: { ...headers, Upgrade: 'websocket' }, signal,
  }) as Response & { webSocket?: RealtimeSocket };
  if (response.status !== 101 || !response.webSocket) {
    try { response.webSocket?.close(); } catch { /* Failed upgrade. */ }
    throw new Error('Realtime upgrade failed.');
  }
  return response.webSocket;
};

export function createRealtimeSpeaker(config: {
  client?: OpenAIClient; apiKey?: string; baseUrl?: string; model?: string; voice?: string;
  connect?: RealtimeConnect; warn?: (entry: SpeechWarning) => void;
}): Speaker {
  const client = config.client ?? createOpenAIClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  return {
    async speak(text, signal) {
      if (signal?.aborted) return { ok: false, reason: '음성 요청이 중단되었습니다.' };
      if (typeof text !== 'string' || !text.trim() || [...text].length > MAX_TTS_TEXT_LENGTH) {
        return { ok: false, reason: `음성 입력은 1~${MAX_TTS_TEXT_LENGTH}자여야 합니다.` };
      }
      if (!client.apiKey?.trim()) return { ok: false, reason: '음성 생성 API 키가 설정되지 않았습니다.' };
      const timeout = AbortSignal.timeout(client.timeouts.speech);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const baseUrl = client.baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
      const url = `${baseUrl}/realtime?model=${encodeURIComponent(config.model?.trim() || 'gpt-realtime-2.1-mini')}`;

      return new Promise<Result<AudioClip>>(resolve => {
        let socket: RealtimeSocket | undefined;
        let finished = false;
        let started = false;
        let requested = false;
        let byteLength = 0;
        let transcriptLength: number | undefined;
        const chunks: Uint8Array[] = [];
        const close = (owned: RealtimeSocket) => { try { owned.close(); } catch { /* Already disconnected. */ } };
        const finish = (result: Result<AudioClip>) => {
          if (finished) return;
          finished = true;
          combined.removeEventListener('abort', onAbort);
          if (socket) {
            socket.removeEventListener('open', onOpen);
            socket.removeEventListener('message', onMessage);
            socket.removeEventListener('error', onError);
            socket.removeEventListener('close', onClose);
            close(socket);
          }
          chunks.length = 0;
          resolve(result);
        };
        const fail = (reason = '음성을 만들지 못했습니다.') => finish({ ok: false, reason });
        const onAbort = () => fail(signal?.aborted ? '음성 요청이 중단되었습니다.' : '음성 생성 응답 시간이 초과되었습니다.');
        const onError = () => fail('음성 생성 공급자에 연결하지 못했습니다.');
        const onClose = () => fail('음성 생성 연결이 중단되었습니다.');
        const send = (event: unknown) => socket!.send(JSON.stringify(event));
        const onOpen = () => {
          if (started || finished) return;
          started = true;
          try {
            send({ type: 'session.update', session: {
              type: 'realtime', output_modalities: ['audio'], instructions: INSTRUCTIONS,
              audio: { input: { turn_detection: null }, output: { format: { type: 'audio/pcm', rate: 24000 }, voice: config.voice?.trim() || 'coral' } },
              max_output_tokens: 2048,
            } });
          } catch { onError(); }
        };
        const onMessage = (event: Event) => {
          if (finished) return;
          try {
            const raw: unknown = (event as MessageEvent).data;
            if (typeof raw !== 'string' || raw.length > Math.ceil(MAX_WAV_BYTES / 3) * 4 + 1024) return fail('음성 생성 응답 크기를 초과했습니다.');
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object' || typeof data.type !== 'string') return fail();
            if (data.type === 'error') return fail(); // Never surface provider diagnostics.
            if (data.type === 'session.updated' && started && !requested) {
              requested = true;
              send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
              send({ type: 'response.create' });
            } else if (requested && data.type === 'response.output_audio.delta') {
              if (typeof data.delta !== 'string') return fail();
              if (data.delta.length > Math.ceil((MAX_WAV_BYTES - 44 - byteLength) / 3) * 4) return fail('음성 생성 응답 크기를 초과했습니다.');
              const binary = atob(data.delta);
              if (byteLength + binary.length + 44 > MAX_WAV_BYTES) return fail('음성 생성 응답 크기를 초과했습니다.');
              chunks.push(Uint8Array.from(binary, char => char.charCodeAt(0)));
              byteLength += binary.length;
            } else if (requested && data.type === 'response.output_audio_transcript.done') {
              if (typeof data.transcript !== 'string') return fail();
              transcriptLength = (transcriptLength ?? 0) + [...data.transcript].length;
            } else if (requested && data.type === 'response.done') {
              if (data.response?.status !== 'completed' || !byteLength || byteLength % 2) return fail();
              const pcm = new Uint8Array(byteLength);
              let offset = 0;
              for (const chunk of chunks) { pcm.set(chunk, offset); offset += chunk.length; }
              const inputLength = [...text].length;
              if (transcriptLength !== undefined && (transcriptLength > inputLength * 2 || transcriptLength * 2 < inputLength)) {
                try { (config.warn ?? console.warn)({ event: 'tts_transcript_length_mismatch', inputLength, outputLength: transcriptLength }); }
                catch { /* Logging must not discard generated speech. */ }
              }
              finish({ ok: true, value: { bytes: pcm16ToWav(pcm), mimeType: 'audio/wav' } });
            }
          } catch { fail(); }
        };

        combined.addEventListener('abort', onAbort, { once: true });
        if (combined.aborted) { onAbort(); return; }
        Promise.resolve().then(() => (config.connect ?? connectWorkers)(url, { Authorization: `Bearer ${client.apiKey}` }, combined))
          .then(connected => {
            if (finished) { close(connected); return; }
            socket = connected;
            socket.addEventListener('open', onOpen);
            socket.addEventListener('message', onMessage);
            socket.addEventListener('error', onError);
            socket.addEventListener('close', onClose);
            socket.accept?.();
            if (socket.readyState === 1) onOpen();
            else if (socket.readyState > 1) onClose();
          }).catch(onError);
      });
    },
  };
}
