import type { Transcriber } from '../domain/talk/transcription.ts';
import { createOpenAIClient, type OpenAIClient } from './openai.ts';

export function createOpenAITranscriber(config: {
  client?: OpenAIClient; apiKey?: string; baseUrl?: string; model?: string; fetcher?: typeof fetch;
}): Transcriber {
  const client = config.client ?? createOpenAIClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, fetcher: config.fetcher });
  return {
    async transcribe(audio, signal) {
      if (!client.apiKey?.trim()) return { ok: false, reason: '음성 인식 API 키가 설정되지 않았습니다.' };
      const timeout = AbortSignal.timeout(client.timeouts.transcription);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        combined.throwIfAborted();
        const mime = audio.type.split(';')[0]!.trim().toLowerCase();
        const extension = ({ 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' } as Record<string, string>)[mime] ?? 'wav';
        const body = new FormData();
        body.append('file', audio, `speech.${extension}`);
        body.append('model', config.model?.trim() || 'gpt-transcribe');
        body.append('language', 'ja');
        const response = await client.fetcher(client.url('/audio/transcriptions'), {
          method: 'POST', headers: { Authorization: `Bearer ${client.apiKey}` }, body, signal: combined,
        });
        // Do not read or log provider error bodies: they can contain credentials or speech.
        if (!response.ok) return { ok: false, reason: `음성 인식 요청에 실패했습니다. (HTTP ${response.status})` };
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string') {
          return { ok: false, reason: '음성 인식 응답 형식이 올바르지 않습니다.' };
        }
        return { ok: true, value: data.text };
      } catch {
        return { ok: false, reason: signal?.aborted ? '음성 인식 요청이 중단되었습니다.'
          : timeout.aborted ? '음성 인식 응답 시간이 초과되었습니다.' : '음성 인식 공급자에 연결하지 못했습니다.' };
      }
    },
  };
}
