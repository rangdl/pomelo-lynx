/**
 * Native driver: drives a Lynx page running on a real device through the
 * `agent-lynx` CLI (Lynx DevTool).
 *
 * The CLI is the officially supported entry point and already exposes the
 * whole action surface we need — snapshot / tap / get text / get style /
 * screenshot / console — so this driver shells out to it instead of
 * re-implementing the DevTool protocol the way songloft-player-lynx does
 * with its own `LynxInspector` websocket client.
 *
 * Device prerequisites: `adb devices` shows the target, and the Lynx
 * Explorer app is running with the page under test already open.
 */

import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  collectNodes,
  normalizeSnapshot,
  parseStyle,
  type SnapshotNode,
} from './snapshot-parse.js';
import {
  type E2EDriver,
  type E2EElement,
  type ElementRect,
  isExpectedError,
  type WaitOptions,
} from './types.js';

const execFileAsync = promisify(execFile);

export interface NativeDriverOptions {
  /** Bundle the device is expected to have open. */
  bundle?: string;
  /** Client id to target. Defaults to the first available client. */
  clientId?: string;
  /** Directory screenshots are written to. */
  screenshotDir?: string;
  /** Extra args forwarded to every `agent-lynx` invocation. */
  clientArgs?: string[];
}

const NO_CLIENT_HINT =
  '[e2e] No Lynx DevTool clients found. Connect the device, start Lynx Explorer, ' +
  'and open the page under test.';

export class NativeDriver implements E2EDriver {
  readonly #options: NativeDriverOptions;
  #clientId: string | undefined;

  constructor(options: NativeDriverOptions = {}) {
    this.#options = options;
  }

  async launch(): Promise<void> {
    this.#clientId = this.#options.clientId ?? (await this.#firstClientId());
  }

  async teardown(): Promise<void> {
    this.#clientId = undefined;
  }

  async open(bundle: string): Promise<void> {
    // The page under test is opened in Lynx Explorer by the operator (or by
    // scanning the QR code from `pnpm dev`). Opening a bundle over the air
    // needs a reachable URL, which is deployment specific, so the driver
    // only verifies that a client is reachable.
    const clients = await this.#run('list-clients');
    if (!Array.isArray(clients) || clients.length === 0) {
      throw new Error(NO_CLIENT_HINT);
    }
    if (!bundle) {
      throw new Error('[e2e] A bundle name is required.');
    }
  }

  async query(testId: string): Promise<E2EElement> {
    const node = await this.#findNode(testId);
    if (!node?.ref) {
      throw new Error(`[e2e] No element with data-testid="${testId}"`);
    }
    return this.#wrap(node.ref, testId);
  }

  async queryAll(testId: string): Promise<E2EElement[]> {
    const snapshot = await this.#snapshot();
    const nodes: SnapshotNode[] = [];
    collectNodes(snapshot, testId, nodes);
    return nodes
      .filter((node) => node.ref)
      .map((node) => this.#wrap(node.ref as string, testId));
  }

  async getConsoleErrors(): Promise<string[]> {
    const raw = await this.#run('get-console', '--level', 'error');
    const messages = Array.isArray(raw)
      ? raw.map((entry) => String(entry))
      : [String(raw)];
    return messages.filter((message) => message && !isExpectedError(message));
  }

  async waitFor(
    predicate: () => Promise<boolean>,
    opts: WaitOptions = {},
  ): Promise<void> {
    const timeout = opts.timeout ?? 5000;
    const interval = opts.interval ?? 100;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (await predicate()) {
        return;
      }
      await this.sleep(interval);
    }
    throw new Error(`waitFor timed out after ${timeout}ms`);
  }

  async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async screenshot(name: string): Promise<string> {
    const dir =
      this.#options.screenshotDir ?? join(process.cwd(), 'results', 'e2e');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${name}.jpeg`);
    await this.#run('screenshot', '-o', file);
    return file;
  }

  #wrap(ref: string, testId: string): E2EElement {
    return {
      tap: async () => {
        await this.#run('tap', ref);
      },
      getText: async () => {
        const text = await this.#run('get', 'text', ref);
        return typeof text === 'string' ? text : JSON.stringify(text);
      },
      isVisible: async () => {
        const rect = await this.#rectOf(ref);
        return rect.width > 0 && rect.height > 0;
      },
      getAttribute: async (name: string) => {
        // `agent-lynx get` only offers `text` and `style`; attribute reads
        // therefore come from the snapshot node itself.
        const node = await this.#findNode(testId);
        const attributes = node?.attributes ?? node?.attrs;
        if (attributes && typeof attributes === 'object') {
          const value = (attributes as Record<string, unknown>)[name];
          return value == null ? null : String(value);
        }
        return null;
      },
      getRect: async () => this.#rectOf(ref),
    };
  }

  async #rectOf(ref: string): Promise<ElementRect> {
    const style = parseStyle(
      await this.#run(
        'get',
        'style',
        ref,
        '--property',
        'width,height,left,top',
      ),
    );
    return {
      x: style.left ?? style.x ?? 0,
      y: style.top ?? style.y ?? 0,
      width: style.width ?? 0,
      height: style.height ?? 0,
    };
  }

  async #findNode(testId: string): Promise<SnapshotNode | undefined> {
    const snapshot = await this.#snapshot();
    const found: SnapshotNode[] = [];
    collectNodes(snapshot, testId, found);
    return found[0];
  }

  async #snapshot(): Promise<SnapshotNode> {
    return normalizeSnapshot(await this.#run('snapshot', '--json'));
  }

  async #firstClientId(): Promise<string> {
    const clients = await this.#run('list-clients');
    if (!Array.isArray(clients) || clients.length === 0) {
      throw new Error(NO_CLIENT_HINT);
    }
    const first = clients[0] as Record<string, unknown>;
    const id = first.id ?? first.clientId ?? first.client_id ?? first.name;
    if (typeof id !== 'string' || !id) {
      throw new Error(
        '[e2e] Could not determine the client id from `agent-lynx list-clients`. ' +
          `Raw output: ${JSON.stringify(first)}`,
      );
    }
    return id;
  }

  /** Run an `agent-lynx` subcommand and parse its JSON output. */
  async #run(...args: string[]): Promise<unknown> {
    const argv = [...(this.#options.clientArgs ?? []), ...args];
    if (this.#clientId) {
      argv.push('-c', this.#clientId);
    }

    const { stdout } = await execFileAsync('agent-lynx', argv, {
      maxBuffer: 32 * 1024 * 1024,
    });
    const trimmed = stdout.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
}
