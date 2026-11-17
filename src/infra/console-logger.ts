const levels: Record<string, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: Infinity,
};

// Shares the event adapters with Pino, without importing its runtime or transports.
export function createConsoleLogger({
  level = 'info', console: sink = console,
}: { level?: string; console?: Pick<Console, 'info' | 'warn' | 'error'> } = {}) {
  const threshold = levels[level] ?? levels.info!;
  const write = (severity: 'info' | 'warn' | 'error') => (fields: unknown, ...args: unknown[]) => {
    if (levels[severity]! < threshold) return;
    const structured = fields !== null && typeof fields === 'object';
    sink[severity]({
      ...(structured ? fields : {}),
      level: levels[severity],
      time: new Date().toISOString(),
      msg: structured ? args[0] : fields,
    });
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}
