export const APP_KEYS: readonly string[];
export function filterAppSecrets(text: string): Record<string, string>;
export function parseDeployment(output: string): { url: string; versionId: string } | null;
export function judgeSmoke(path: string, status: number, contentType: string, body: string): { ok: boolean; length: number; contentPresent: boolean };
export function classifyWorktree(porcelain: string): { dirty: string[]; untracked: string[] };
export function staleSecretNames(output: string, localSecrets: Record<string, string>): string[];
