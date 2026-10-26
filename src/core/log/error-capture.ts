import { logger } from './logger.js';

/**
 * Capture crashes that never reach a `catch` — the `error` /
 * `unhandledrejection` events, capability-probed because not every realm
 * has an event target at all (PrimJS on device may not; a Web Worker does —
 * on Web the app code itself lives in one).
 *
 * Pattern ported from songloft's `client-logger.installCrashCapture`.
 */

interface ErrorEventLike {
  message?: string;
  filename?: string;
  lineno?: number;
  error?: unknown;
}

function describeThrown(value: unknown): string {
  if (value instanceof Error) {
    const frames = value.stack
      ? ` | ${value.stack.split('\n').slice(0, 4).join(' ⏎ ')}`
      : '';
    return `${value.name}: ${value.message}${frames}`;
  }
  return `non-error thrown: ${String(value)}`;
}

let installed = false;

export function installErrorCapture(): void {
  if (installed) return;
  installed = true;
  const target = globalThis as {
    addEventListener?: (
      type: string,
      callback: (event: unknown) => void,
    ) => void;
  };
  if (typeof target.addEventListener !== 'function') return;
  try {
    target.addEventListener('error', (event: unknown) => {
      const ev = event as ErrorEventLike;
      const where = ev?.filename ? ` @${ev.filename}:${ev.lineno ?? 0}` : '';
      const body =
        ev?.error !== undefined
          ? describeThrown(ev.error)
          : (ev?.message ?? 'unknown');
      logger.error('crash', `uncaught ${body}${where}`);
    });
    target.addEventListener('unhandledrejection', (event: unknown) => {
      const ev = event as { reason?: unknown };
      logger.error(
        'crash',
        `unhandled rejection ${describeThrown(ev?.reason)}`,
      );
    });
  } catch {
    /* A realm that rejects these event names is simply not covered. */
  }
}
