"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

/**
 * Light / dark switch. Light is the studio default; dark is opt-in.
 * Icons are picked by CSS (`dark:` variants), so there is no hydration
 * mismatch and no state — the click just flips the theme.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${className}`}
      aria-label="Toggle light and dark mode"
      title="Toggle light / dark mode"
    >
      <Moon className="h-[18px] w-[18px] dark:hidden" aria-hidden />
      <Sun className="hidden h-[18px] w-[18px] dark:block" aria-hidden />
    </button>
  );
}
