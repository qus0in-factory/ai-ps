export interface CommandOptions { cwd?: string; forwardOutput?: boolean; input?: string; timeoutMs?: number; }
export type Executor = (step: string, executable: string, args: string[], options?: CommandOptions) => string | Promise<string>;
export interface RunOptions { cwd?: string; execute?: Executor; print?: (line: string) => void; }
export const ROOT: string;
export const STORE: string;
export const DEFAULT_URL: string;
export function command(step: string, executable: string, args: string[], options?: CommandOptions): Promise<string>;
export function cleanOutput(text: string): string;
export function fail(step: string, reason: string): never;
export function noLocalStore(cwd?: string): void;
export function parseOptions(args: string[], flags: string[]): { values: string[]; timeoutMs: number };
export function cli(moduleUrl: string, main: (args: string[]) => unknown): Promise<void>;
