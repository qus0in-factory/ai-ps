import type { GenerationEvent } from '../../../domain/queens/generation.ts';

function safeLine(text: string): string {
  return text.replace(/\{\s*"row"\s*:\s*-?\d+\s*,\s*"column"\s*:\s*-?\d+\s*\}/g, '(가려짐)')
    .replace(/\(\s*-?\d+\s*,\s*-?\d+\s*\)/g, '(가려짐)')
    .replace(/[\u0000-\u001f\u007f]/g, ' ');
}

export function generationEventText(event: GenerationEvent): string {
  switch (event.kind) {
    case 'placement': return '정답 배치';
    case 'model': return event.path === 'model' ? '모델 제안 반영' : event.path === 'model-seed' ? '모델 시드 기반' : `모델 없이 생성 (${safeLine(event.reason ?? '제안 없음')})`;
    case 'repair': return safeLine(event.message);
    case 'complete': return '완료';
    case 'stopped': return safeLine(event.reason);
  }
}
