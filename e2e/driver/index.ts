import type { E2EDriver } from './types.js';

export type {
  E2EDriver,
  E2EElement,
  ElementRect,
  WaitOptions,
} from './types.js';
export { IGNORED_ERROR_PATTERNS, isExpectedError } from './types.js';

/**
 * Create the driver for the current platform.
 *
 * `E2E_PLATFORM=web` drives the bundle in a browser through `lynx-view`;
 * `E2E_PLATFORM=native` drives it on a real device through LynxExplorer.
 * Scenarios are written against the `E2EDriver` interface and never branch
 * on the platform themselves.
 */
export async function createDriver(): Promise<E2EDriver> {
  const platform = process.env.E2E_PLATFORM ?? 'web';

  switch (platform) {
    case 'web': {
      const { WebDriver } = await import('./web.driver.js');
      return new WebDriver({
        baseUrl: process.env.E2E_BASE_URL,
        root: process.env.E2E_DIST_ROOT,
        bundle: process.env.E2E_BUNDLE ?? 'probe.web.bundle',
      });
    }
    case 'native': {
      const { NativeDriver } = await import('./native.driver.js');
      return new NativeDriver({
        bundle: process.env.E2E_BUNDLE ?? 'probe.lynx.bundle',
        clientId: process.env.E2E_CLIENT_ID,
      });
    }
    default:
      throw new Error(
        `Unknown E2E_PLATFORM: "${platform}". Set E2E_PLATFORM=web or E2E_PLATFORM=native.`,
      );
  }
}
