/**
 * Log level contract — must stay byte-aligned with the native stores
 * (`LogStore.swift`'s `LogLevel` enum / Android `LogLevel.kt`): the numeric
 * value travels over the bridge in every entry and in `setLevel`.
 */
export const LOG_LEVELS = [
  'verbose',
  'debug',
  'info',
  'warn',
  'error',
] as const;

export type LogLevelName = (typeof LOG_LEVELS)[number];

export const LEVEL_VALUE: Record<LogLevelName, number> = {
  verbose: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

export const VALUE_LEVELS: LogLevelName[] = [...LOG_LEVELS];

/** Numeric → name, clamping out-of-contract values to the nearest valid level. */
export function levelName(value: number): LogLevelName {
  if (value <= LEVEL_VALUE.verbose) return 'verbose';
  if (value >= LEVEL_VALUE.error) return 'error';
  return VALUE_LEVELS[Math.round(value)] ?? 'debug';
}

/** File line letter (`[I/tag]`), same mapping as the Swift `LogLevel.letter`. */
export function levelLetter(value: number): string {
  return levelName(value).charAt(0).toUpperCase();
}
