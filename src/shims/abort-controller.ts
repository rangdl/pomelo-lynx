/**
 * 最小 `AbortController`/`AbortSignal` polyfill(移植自 songloft-player-lynx)。
 *
 * `AbortController` 是 WHATWG API,不属于 ECMAScript。iOS 真机的 JavaScriptCore
 * 可能没有它;运行时代码(ClientUpdateSection 下载取消、fetch signal 等)在
 * 缺失时会 ReferenceError。引擎自带(如 Web 端 V8/Worker)时原样保留。
 *
 * 在入口最先执行;幂等。
 */
export function ensureAbortController(): void {
  const g = globalThis as { AbortController?: unknown };
  if (typeof g.AbortController !== 'undefined') return;

  class PolyfillAbortSignal {
    aborted = false;
    reason: unknown = undefined;
    private listeners = new Set<(ev: unknown) => void>();
    addEventListener(_type: string, cb: (ev: unknown) => void): void {
      this.listeners.add(cb);
    }
    removeEventListener(_type: string, cb: (ev: unknown) => void): void {
      this.listeners.delete(cb);
    }
    throwIfAborted(): void {
      if (this.aborted) throw this.reason;
    }
    _abort(reason: unknown): void {
      if (this.aborted) return;
      this.aborted = true;
      this.reason = reason;
      for (const cb of this.listeners) cb({ type: 'abort' });
    }
  }

  class PolyfillAbortController {
    readonly signal = new PolyfillAbortSignal();
    abort(reason?: unknown): void {
      this.signal._abort(reason);
    }
  }

  g.AbortController = PolyfillAbortController;
  const gs = globalThis as { AbortSignal?: unknown };
  if (typeof gs.AbortSignal === 'undefined')
    gs.AbortSignal = PolyfillAbortSignal;
}

ensureAbortController();
