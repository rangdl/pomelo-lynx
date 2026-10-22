/**
 * E2E driver abstraction.
 *
 * A driver hides *where* the Lynx page runs (browser via `lynx-view`, or a
 * real device via LynxExplorer) so that scenarios stay platform-agnostic.
 * The interface mirrors the shape used by songloft-player-lynx, trimmed to
 * what the alignment probe actually needs.
 */

/** Geometry of a node, in CSS pixels relative to the viewport. */
export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single addressable node, located by `data-testid`. */
export interface E2EElement {
  /** Dispatch a tap on the node. */
  tap(): Promise<void>;
  /** Visible text content of the node. */
  getText(): Promise<string>;
  /** Whether the node is rendered with non-zero dimensions. */
  isVisible(): Promise<boolean>;
  /** Read an attribute (e.g. `data-testid`, `class`). */
  getAttribute(name: string): Promise<string | null>;
  /** Bounding box of the node. */
  getRect(): Promise<ElementRect>;
}

export interface WaitOptions {
  /** Total wait budget in ms. Default 5000. */
  timeout?: number;
  /** Poll interval in ms. Default 100. */
  interval?: number;
}

/** Error patterns that are expected and must not fail a run. */
export const IGNORED_ERROR_PATTERNS = [
  // The probe page points at a deliberately fake image host to exercise the
  // image element's fallback path. The DNS failure is by design.
  'ERR_NAME_NOT_RESOLVED',
  'lynx.cdn.example',
];

export interface E2EDriver {
  // ── Lifecycle ──
  launch(): Promise<void>;
  teardown(): Promise<void>;

  // ── Navigation ──
  /**
   * Load the given bundle. `bundle` is a file name such as
   * `probe.web.bundle`; drivers translate it to whatever their platform
   * needs (a `<lynx-view>` url, or a bundle already opened in Explorer).
   */
  open(bundle: string): Promise<void>;

  // ── Element Interaction ──
  query(testId: string): Promise<E2EElement>;
  queryAll(testId: string): Promise<E2EElement[]>;

  // ── State Reading ──
  /** Console errors collected since launch, with expected ones filtered out. */
  getConsoleErrors(): Promise<string[]>;

  // ── Utilities ──
  waitFor(predicate: () => Promise<boolean>, opts?: WaitOptions): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Capture a screenshot; returns the written file path. */
  screenshot(name: string): Promise<string>;
}

/** True when `message` is an expected error that must not fail a run. */
export function isExpectedError(message: string): boolean {
  return IGNORED_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}
