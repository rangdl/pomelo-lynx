/**
 * Pure parsing helpers for the native (agent-lynx) driver.
 *
 * These are separated from the driver itself for two reasons: they can be
 * unit-tested without a device attached, and the CLI's output shape is the
 * part most likely to drift between versions.
 */

/** A snapshot node as emitted by `agent-lynx snapshot --json`. */
export interface SnapshotNode {
  ref?: string;
  testid?: string;
  testId?: string;
  'data-testid'?: string;
  attributes?: Record<string, unknown>;
  attrs?: Record<string, unknown>;
  text?: string;
  children?: SnapshotNode[];
}

/** The testid of a snapshot node, tolerating the field-name variations. */
export function testIdOf(node: SnapshotNode): string | undefined {
  return node.testid ?? node.testId ?? node['data-testid'];
}

/**
 * `agent-lynx snapshot --json` returns a command-result envelope, not a bare
 * node tree. Unwrap the known envelope shapes so the tree can be walked
 * either way. Envelopes can be nested (`{ result: { data: tree } }`), so
 * unwrapping repeats until a node tree is reached.
 */
export function normalizeSnapshot(raw: unknown): SnapshotNode {
  const ENVELOPE_KEYS = ['data', 'result', 'snapshot', 'value'] as const;
  let node: unknown = raw;

  for (let depth = 0; depth < 5; depth += 1) {
    if (!node || Array.isArray(node) || typeof node !== 'object') {
      break;
    }
    const record = node as Record<string, unknown>;
    if (record.children) {
      // Already a node tree.
      break;
    }

    let unwrapped = false;
    for (const key of ENVELOPE_KEYS) {
      const inner = record[key];
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        node = inner;
        unwrapped = true;
        break;
      }
    }
    if (!unwrapped) {
      break;
    }
  }

  if (Array.isArray(node)) {
    return { children: node };
  }
  return (node as SnapshotNode) ?? {};
}

/** Collect every node whose testid matches. */
export function collectNodes(
  root: SnapshotNode,
  testId: string,
  out: SnapshotNode[] = [],
): SnapshotNode[] {
  const visit = (node: SnapshotNode | undefined): void => {
    if (!node) {
      return;
    }
    if (testIdOf(node) === testId) {
      out.push(node);
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return out;
}

/**
 * Parse the output of `agent-lynx get style`. It may be a JSON object or a
 * `property: value` text blob, depending on the CLI version.
 */
export function parseStyle(raw: unknown): Record<string, number> {
  const parsed: Record<string, number> = {};

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        parsed[key] = numeric;
      }
    }
    return parsed;
  }

  for (const part of String(raw ?? '').split(/[;,\n]/)) {
    const match = part.match(/([a-zA-Z-]+)\s*:\s*(-?\d+(?:\.\d+)?)/);
    if (match) {
      parsed[match[1]] = Number(match[2]);
    }
  }
  return parsed;
}
