/**
 * Dance color and emoji mapping for display components.
 * No clinical condition names — dance names only.
 */

export const DANCE_COLORS: Record<string, string> = {
  'The Waltz': '#22c55e',
  'The Lock-Step': '#ef4444',
  'The Sway': '#3b82f6',
  'The Mosh Pit': '#a855f7',
  'The Stumble': '#f59e0b',
  'Uncertain': '#64748b',
};

export const DANCE_EMOJIS: Record<string, string> = {
  'The Waltz': '\u{1F7E2}',      // 🟢
  'The Lock-Step': '\u{1F534}',   // 🔴
  'The Sway': '\u{1F535}',        // 🔵
  'The Mosh Pit': '\u{1F7E3}',   // 🟣
  'The Stumble': '\u{1F7E1}',    // 🟡
  'Uncertain': '\u{2753}',        // ❓
};

export function getDanceColor(danceName: string | null): string {
  if (!danceName) return DANCE_COLORS['Uncertain'];
  return DANCE_COLORS[danceName] ?? DANCE_COLORS['Uncertain'];
}

export function getDanceEmoji(danceName: string | null): string {
  if (!danceName) return DANCE_EMOJIS['Uncertain'];
  return DANCE_EMOJIS[danceName] ?? DANCE_EMOJIS['Uncertain'];
}
