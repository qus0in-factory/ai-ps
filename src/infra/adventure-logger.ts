import type { AdventureLogListener } from '../domain/adventure/logging.ts';
export function createAdventureLogger(logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }): AdventureLogListener {
  return entry => {
    const level = entry.event === 'model_error' ? 'error' : entry.event === 'invalid' ? 'warn' : 'info';
    logger[level]({ component: 'adventure', event: entry.event, turn: entry.turn, ...(entry.round === undefined ? {} : { round: entry.round }), ...(entry.narrativeLength === undefined ? {} : { narrativeLength: entry.narrativeLength }) }, '모험 진행');
  };
}
