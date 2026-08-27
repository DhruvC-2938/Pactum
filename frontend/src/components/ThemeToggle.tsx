import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { nextTheme } from '../lib/themeCycle';

export function ThemeToggle() {
  const { preference, resolvedTheme, setPreference } = useTheme();

  const cycle = () => setPreference(nextTheme(preference));

  const Icon: LucideIcon =
    preference === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  const label =
    preference === 'system'
      ? `Theme: System (currently ${resolvedTheme}). Click for Light.`
      : `Theme: ${preference === 'dark' ? 'Dark' : 'Light'}. Click for ${
          preference === 'dark' ? 'System' : 'Dark'
        }.`;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-accent/20"
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}
