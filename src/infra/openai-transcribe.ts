import type { Transcriber } from '../domain/talk/transcription.ts';

export function createOpenAITranscriber(config: {
  apiKey?: string; baseUrl?: string; model?: string; fetcher?: typeof fetch;
}): Transcriber {
  return {
    async transcribe(audio, signal) {
      if (!config.apiKey?.trim()) return { ok: false, reason: '음성 인식 API 키가 설정되지 않았습니다.' };
      const timeout = AbortSignal.timeout(30_000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        combined.throwIfAborted();
        const mime = audio.type.split(';')[0]!.trim().toLowerCase();
        const extension = ({ 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' } as Record<string, string>)[mime] ?? 'wav';
        const body = new FormData();
        body.append('file', audio, `speech.${extension}`);
        body.append('model', config.model?.trim() || 'gpt-transcribe');
        body.append('language', 'ja');
        const baseUrl = (config.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const response = await (config.fetcher ?? fetch)(`${baseUrl}/audio/transcriptions`, {
          method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body, signal: combined,
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
