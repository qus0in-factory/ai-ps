export const APP_KEYS: readonly string[];
export function mergeSmokePaths(features: readonly { route?: string }[]): string[];
export function trackedPublicAssets(output: string): { files: string[] };
export function assetVerdict(status: number, local: Uint8Array, remote: Uint8Array): 'PASS' | 'MISMATCH' | 'HTTP';
export function filterAppSecrets(text: string): Record<string, string>;
export function parseDeployment(output: string): { url: string; versionId: string } | null;
export function judgeSmoke(path: string, status: number, contentType: string, body: string): { ok: boolean; length: number; contentPresent: boolean };
export function classifyWorktree(porcelain: string): { dirty: string[]; untracked: string[] };
export function staleSecretNames(output: string, localSecrets: Record<string, string>): string[];
