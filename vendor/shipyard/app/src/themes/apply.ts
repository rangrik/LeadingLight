import type { Theme } from "@/lib/api";
import { toneColors } from "./tones.ts";

// applyTheme writes a theme's colors over the coss tokens in index.css.
// Inline custom properties on <html> win over the stylesheet's :root and
// .dark blocks, so every component follows without knowing about themes.
export function applyTheme(theme: Theme) {
  const c = theme.colors;
  const vars: Record<string, string> = {
    "--background": c.background,
    "--foreground": c.foreground,
    "--card": c.card,
    "--card-foreground": c.foreground,
    "--popover": c.popover,
    "--popover-foreground": c.foreground,
    "--primary": c.primary,
    "--primary-foreground": c.primaryForeground,
    "--secondary": c.muted,
    "--secondary-foreground": c.foreground,
    "--muted": c.muted,
    "--muted-foreground": c.mutedForeground,
    "--accent": c.accent,
    "--accent-foreground": c.accentForeground,
    "--border": c.border,
    "--input": c.border,
    "--ring": c.ring,
    "--success": c.success,
    "--warning": c.warning,
    "--destructive": c.destructive,
    "--sidebar": c.sidebar,
    "--sidebar-foreground": c.sidebarForeground,
    "--sidebar-accent": c.accent,
    "--sidebar-accent-foreground": c.accentForeground,
    "--sidebar-border": c.border,
    "--sidebar-primary": c.primary,
    "--sidebar-primary-foreground": c.primaryForeground,
    "--sidebar-ring": c.ring,
    "--terminal-background": theme.terminal.background,
  };
  // A theme may leave these out: the stylesheet's own then show through,
  // not the last theme's.
  const optional: Record<string, string | undefined> = {
    "--info": c.info,
    "--success-foreground": c.successForeground,
    "--warning-foreground": c.warningForeground,
    "--destructive-foreground": c.destructiveForeground,
    "--info-foreground": c.infoForeground,
    "--link": c.link,
    "--selection": c.selection,
  };
  // Worktree tones, at the lightness this theme's surfaces read them at.
  for (const [t, v] of Object.entries(toneColors(theme))) vars[`--wt-${t}`] = v;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(optional)) {
    if (v) root.style.setProperty(k, v);
    else root.style.removeProperty(k);
  }
  root.classList.toggle("dark", theme.appearance === "dark");
  root.style.colorScheme = theme.appearance;
}

// syntaxThemes is the Shiki theme pair the diff renderer colours code with:
// the theme's own on its side, Pierre's on the other.
export function syntaxThemes(theme: Theme): { dark: string; light: string } {
  const own = theme.syntax;
  return { dark: theme.appearance === "dark" && own ? own : "pierre-dark", light: theme.appearance === "light" && own ? own : "pierre-light" };
}

// xtermTheme is the terminal palette in xterm.js's own names.
export function xtermTheme(theme: Theme) {
  return { ...theme.terminal, cursorAccent: theme.terminal.background };
}
