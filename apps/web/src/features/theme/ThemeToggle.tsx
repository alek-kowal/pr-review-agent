import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import { toggleTheme, useTheme } from './theme.ts';

/** The top-bar button that switches between the light and the dark theme (S-17-T7). */
export function ThemeToggle() {
  const theme = useTheme();
  const label = theme === 'dark' ? copy.theme.toLight : copy.theme.toDark;
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={toggleTheme}
      className="text-text-2"
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
