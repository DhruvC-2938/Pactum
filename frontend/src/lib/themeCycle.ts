import type { ThemePreference } from '../context/ThemeContext';

/**
 * Order used when cycling the toggle button: System → Light → Dark → System.
 * Starting from "system" keeps the acceptance-criteria default (first load
 * follows the OS preference) while still allowing one-click manual toggling.
 */
export const THEME_CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

export function nextTheme(current: ThemePreference): ThemePreference {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
}
