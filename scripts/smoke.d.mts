import type { Executor } from './lib/command.mjs';
export interface SmokeOptions {
  cwd?: string;
  execute?: Executor;
  fetcher?: typeof fetch;
  table?: (rows: unknown[]) => void;
  print?: (line: string) => void;
  features?: readonly { route?: string }[];
  readAsset?: (path: string) => Uint8Array | Promise<Uint8Array>;
  delay?: (ms: number) => void | Promise<void>;
}
export function smoke(args: string[], options?: SmokeOptions): Promise<boolean>;
