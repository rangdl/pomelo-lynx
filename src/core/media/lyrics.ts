import type { PlayerLyricMode } from '../../native/player.js';

export interface LyricLine {
  time: number;
  text: string;
}

const TAG = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g;
const MAX_LINES = 5000;

/** 解析 LRC;同一行多个时间戳会展开,空行和元数据标签会被忽略。 */
export function parseLrc(input: string): LyricLine[] {
  if (!input) return [];
  const byTime = new Map<number, string>();
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^\[[a-zA-Z]+:.*\]$/.test(line)) continue;
    const times: number[] = [];
    TAG.lastIndex = 0;
    for (const match of line.matchAll(TAG)) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
        times.push(minutes * 60 + seconds);
      }
    }
    if (!times.length) continue;
    const text = line.replace(TAG, '').trim();
    if (!text) continue;
    for (const time of times) {
      byTime.set(Math.round(time * 1000) / 1000, text.slice(0, 240));
      if (byTime.size >= MAX_LINES) break;
    }
    if (byTime.size >= MAX_LINES) break;
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, text]) => ({ time, text }));
}

export type { PlayerLyricMode };
