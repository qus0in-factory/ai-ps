import type { Executor } from './lib/command.mjs';
export interface VerifyHeadIO {
  mkdtemp(prefix: string): Promise<string>;
  symlink(from: string, to: string): Promise<unknown>;
  rmSync(dir: string, options: { recursive: true; force: true }): void;
  existsSync(path: string): boolean;
  gitSync(args: string[]): boolean;
}
export interface VerifyHeadOptions {
  cwd?: string;
  execute?: Executor;
  print?: (line: string) => void;
  signalTarget?: { on(event: string, listener: () => void): unknown; removeListener(event: string, listener: () => void): unknown };
  io?: VerifyHeadIO;
}
export function gitSucceeded(result?: { status?: number | null; error?: unknown; signal?: string | null }): boolean;
export function verifyHead(args: string[], options?: VerifyHeadOptions): Promise<{
  ok: boolean; dir?: string; interrupted?: boolean; interruptedCode?: number;
}>;
