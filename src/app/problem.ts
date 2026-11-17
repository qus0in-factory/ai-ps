import type { ProblemDetails } from '../domain/problem.ts';

const titles: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  405: 'Method Not Allowed',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  429: '요청이 너무 많습니다',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
};

export function createProblem(status: number, detail: string, instance: string): ProblemDetails {
  return { type: 'about:blank', title: titles[status] ?? 'Unknown Error', status, detail, instance };
}
