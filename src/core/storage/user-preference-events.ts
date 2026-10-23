export interface UserPreferences {
  theme_mode: 'system' | 'light' | 'dark'
  play_mode: 'order' | 'loop' | 'single' | 'random' | 'singlePlay'
  playlist_view_mode: 'grid' | 'list'
  audio_quality: 'original' | '128' | '192' | '320'
  local_cache_max_size: number
  volume: number
}

export type PreferencePatch = Partial<UserPreferences>
const changes = new Set<(patch: PreferencePatch) => void>()
const applied = new Set<() => void>()

export function preferenceChanged(patch: PreferencePatch): void {
  changes.forEach((listener) => listener(patch))
}
export function subscribePreferenceChanges(listener: (patch: PreferencePatch) => void): () => void {
  changes.add(listener)
  return () => changes.delete(listener)
}
export function preferencesApplied(): void {
  applied.forEach((listener) => listener())
}
export function subscribePreferencesApplied(listener: () => void): () => void {
  applied.add(listener)
  return () => applied.delete(listener)
}
