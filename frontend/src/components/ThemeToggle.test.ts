import { describe, it, expect } from 'vitest';
import { THEME_CYCLE, nextTheme } from '../lib/themeCycle';
import type { ThemePreference } from '../context/ThemeContext';

describe('ThemeToggle cycle', () => {
  it('cycles in system → light → dark → system order', () => {
    expect(THEME_CYCLE).toEqual(['system', 'light', 'dark']);
  });

  it('advances to the next preference and wraps around', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it('every preference maps to exactly one valid next preference', () => {
    const all: ThemePreference[] = ['system', 'light', 'dark'];
    for (const pref of all) {
      expect(THEME_CYCLE).toContain(nextTheme(pref));
    }
  });
});
