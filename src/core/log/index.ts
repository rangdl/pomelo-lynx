import { clientBuild } from '../config/constants.js';
import { installConsoleCapture } from './console-capture.js';
import { installErrorCapture } from './error-capture.js';
import { logger, setBridgeSink } from './logger.js';
import { bridgeAppend } from './native-log.js';

/**
 * One-time per-realm setup: bridge sink, `console.*` capture, crash capture,
 * session banner. Called from `src/index.tsx` before the first render — the
 * entry module evaluates in both dual-thread realms, so both get covered.
 */

let initialized = false;

export function initLogging(): void {
  if (initialized) return;
  initialized = true;
  setBridgeSink(bridgeAppend);
  installConsoleCapture();
  installErrorCapture();
  logger.info(
    'banner',
    `PomeloLynx js version=${clientBuild.version} channel=${clientBuild.channel} ` +
      `commit=${clientBuild.git_commit} build=${clientBuild.build_time}`,
  );
}

export type { LogLevelName } from './levels.js';
export { LEVEL_VALUE, LOG_LEVELS, levelLetter, levelName } from './levels.js';
export type { BridgeSink, Logger } from './logger.js';
export {
  flushPendingLogs,
  logger,
  makeEntry,
  setBridgeSink,
} from './logger.js';
export type { LogSubscriber } from './logger-core.js';
export { filterEntries, LoggerCore, loggerCore } from './logger-core.js';
export {
  bridgeAppend,
  fetchLevel,
  fetchRecent,
  fetchRetentionDays,
  hasNativeLog,
  setPushEnabled,
  shareRecent,
  storeLevel,
  storeRetentionDays,
  subscribeLogAppend,
} from './native-log.js';
export type { LogEntry, LogSource } from './types.js';
