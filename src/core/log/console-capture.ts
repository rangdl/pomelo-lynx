import { logger } from './logger.js';

/**
 * Route `console.*` into the log store while keeping the original output
 * intact (DevTool console / Xcode stdout must not go dark).
 *
 * Mapping: `debug`→debug, `log`/`info`→info, `warn`→warn, `error`→error —
 * everything under the `console` tag so app logs stay distinguishable by
 * their own tags. Installed per realm (main thread + background each have
 * their own `console`), which is what makes a render-side `console.log`
 * captured too.
 */

type ConsoleMethod = 'debug' | 'log' | 'info' | 'warn' | 'error';

const METHOD_LEVEL: Record<ConsoleMethod, 'debug' | 'info' | 'warn' | 'error'> =
  {
    debug: 'debug',
    log: 'info',
    info: 'info',
    warn: 'warn',
    error: 'error',
  };

const MAX_MSG = 4000;

let installed = false;

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json;
  } catch {
    /* Circular or exotic — fall through. */
  }
  try {
    return String(value);
  } catch {
    return '<unprintable>';
  }
}

export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;
  const consoleRef = (
    globalThis as unknown as { console?: Record<string, unknown> }
  ).console;
  if (!consoleRef) return;
  for (const method of Object.keys(METHOD_LEVEL) as ConsoleMethod[]) {
    const original = consoleRef[method];
    const originalFn =
      typeof original === 'function'
        ? (original as (...args: unknown[]) => void)
        : null;
    consoleRef[method] = (...args: unknown[]): void => {
      try {
        originalFn?.(...args);
      } catch {
        /* A broken native console must not eat the capture. */
      }
      try {
        let text = args.map(stringify).join(' ');
        if (text.length > MAX_MSG)
          text = `${text.slice(0, MAX_MSG)}…(${text.length})`;
        logger[METHOD_LEVEL[method]]('console', text);
      } catch {
        /* Logging must never throw at the call site. */
      }
    };
  }
}
