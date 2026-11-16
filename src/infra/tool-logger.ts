import type { ToolLogger } from '../domain/tools.ts';

export function createToolLogger(): ToolLogger {
  return (entry) => {
    console.log(`[chat] ${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}`);
  };
}
