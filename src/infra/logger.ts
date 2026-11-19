import pino, { type DestinationStream, type LogFn, type LoggerOptions } from 'pino';
import { redactFields } from '../domain/redact.ts';

export function createLogger({
  level = process.env.LOG_LEVEL ?? 'info',
  pretty = process.env.NODE_ENV !== 'production',
  destination,
}: { level?: string; pretty?: boolean; destination?: DestinationStream } = {}) {
  const options: LoggerOptions = {
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    hooks: {
      logMethod(args, method) {
        method.apply(this, args.map(arg => redactFields(arg)) as Parameters<LogFn>);
      },
    },
  };
  if (destination) return pino(options, destination);
  if (!pretty) return pino(options);
  return pino({
    ...options,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: Boolean(process.stdout.isTTY),
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      },
    },
  });
}
