import type { RunOptions } from './lib/command.mjs';
export function deploy(args: string[], options?: RunOptions): Promise<void>;
export function mapResearchSecretNames(text: string): Record<string, string>;
export function filterDeploySecrets(text: string): Record<string, string>;
