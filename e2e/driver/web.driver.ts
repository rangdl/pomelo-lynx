/**
 * Web driver: drives the Lynx page inside a browser through `<lynx-view>`.
 *
 * The page is served by the bundled static server (see `static-server.ts`),
 * so the run exercises the real `dist/` artifact.
 *
 * Playwright's selector engine pierces open shadow roots, and `lynx-view`
 * renders the Lynx element tree inside one, so `getByTestId` addresses Lynx
 * nodes directly — no frame hopping required.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Locator, Page } from 'playwright-core';

import { launchBrowser } from './browser.mjs';
import { type StaticServer, startStaticServer } from './static-server.js';
import {
  type E2EDriver,
  type E2EElement,
  type ElementRect,
  isExpectedError,
  type WaitOptions,
} from './types.js';

export interface WebDriverOptions {
  /**
   * Base URL of an already running server. When omitted the driver starts its
   * own static server over `dist/`, which keeps `pnpm e2e:web` a one-liner.
   */
  baseUrl?: string;
  /** Directory served when the driver starts its own server. Defaults to `dist`. */
  root?: string;
  /** Bundle to load. Defaults to `probe.web.bundle`. */
  bundle?: string;
  /** Viewport used for the run. Defaults to a phone-sized viewport. */
  viewport?: { width: number; height: number };
  /** Directory screenshots are written to. */
  screenshotDir?: string;
}

export class WebDriver implements E2EDriver {
  readonly #options: WebDriverOptions;
  #browser: Browser | null = null;
  #page: Page | null = null;
  #server: StaticServer | null = null;
  #baseUrl = '';
  #errors: string[] = [];

  constructor(options: WebDriverOptions) {
    this.#options = options;
  }

  async launch(): Promise<void> {
    if (this.#options.baseUrl) {
      this.#baseUrl = this.#options.baseUrl;
    } else {
      this.#server = await startStaticServer({ root: this.#options.root });
      this.#baseUrl = this.#server.url;
    }

    // Chrome bootstrap (sandbox handling, console/worker error collection)
    // lives in the shared module, so the web driver and the standalone
    // `web-check.mjs` diagnostic report errors the same way.
    const launched = await launchBrowser({ viewport: this.#options.viewport });
    this.#browser = launched.browser;
    this.#page = launched.page;
    this.#errors = launched.errors;
  }

  async teardown(): Promise<void> {
    await this.#page?.close().catch(() => {});
    await this.#browser?.close().catch(() => {});
    await this.#server?.close();
    this.#page = null;
    this.#browser = null;
    this.#server = null;
  }

  async open(bundle: string): Promise<void> {
    const page = this.#requirePage();
    // A fresh page per bundle: switching the `url` attribute of an existing
    // view keeps the previous bundle's DOM alive for a while, which is long
    // enough for an assertion to read stale content.
    await page.goto(
      `${this.#baseUrl}/index.html?bundle=${encodeURIComponent(bundle)}`,
      {
        waitUntil: 'domcontentloaded',
      },
    );

    await this.#waitForLynxRendered();
  }

  async query(testId: string): Promise<E2EElement> {
    return this.#wrap(this.#requirePage().getByTestId(testId));
  }

  async queryAll(testId: string): Promise<E2EElement[]> {
    const locator = this.#requirePage().getByTestId(testId);
    const count = await locator.count();
    const elements: E2EElement[] = [];
    for (let index = 0; index < count; index += 1) {
      elements.push(this.#wrap(locator.nth(index)));
    }
    return elements;
  }

  async getConsoleErrors(): Promise<string[]> {
    return this.#errors.filter((message) => !isExpectedError(message));
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
    const file = join(dir, `${name}.png`);
    await this.#requirePage().screenshot({ path: file });
    return file;
  }

  #requirePage(): Page {
    if (!this.#page) {
      throw new Error('WebDriver is not launched');
    }
    return this.#page;
  }

  /**
   * Wait until `lynx-view` has rendered the bundle.
   *
   * Lynx renders its element tree as custom elements (`x-view`, `x-text`, …)
   * inside the view's shadow root, so the presence of an `x-view` is the
   * first sign that the bundle was evaluated and painted.
   */
  async #waitForLynxRendered(): Promise<void> {
    await this.#requirePage().waitForFunction(
      () => {
        const view = document.getElementById('view');
        const shadow = (view as HTMLElement | null)?.shadowRoot;
        if (!shadow) {
          return false;
        }
        return shadow.querySelector('x-view') !== null;
      },
      undefined,
      { timeout: 20000 },
    );
  }

  #wrap(locator: Locator): E2EElement {
    return {
      tap: async () => {
        await locator.click({ timeout: 10000 });
      },
      getText: async () => {
        return (await locator.textContent()) ?? '';
      },
      isVisible: async () => {
        return locator.isVisible();
      },
      getAttribute: async (name: string) => {
        return locator.getAttribute(name);
      },
      getRect: async (): Promise<ElementRect> => {
        const box = await locator.boundingBox();
        if (!box) {
          throw new Error('Element has no bounding box (not rendered)');
        }
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      },
    };
  }
}
