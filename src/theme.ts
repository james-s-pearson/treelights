// Treelights themes: plain data mapping capture names to styles.

export interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  undercurl?: boolean;
  strikethrough?: boolean;
  preview?: boolean; // chip: rounded background with an outline (colour previews, alert badges)
  marker?: string; // text shown before the styled text (warning sign, name of an invisible character)
  isolate?: boolean; // contain text-direction control characters so they cannot reorder the line
}

export interface Theme {
  name: string;
  type: "dark" | "light" | "any"; // "any": works in both (Follow Obsidian theme)
  background?: string;
  foreground?: string;
  captures: Record<string, Style>;
}

/**
 * Find the style for a capture in a language, following Neovim's fallback:
 * "a.b.c" in lua tries "a.b.c.lua", "a.b.c", then "a.b.lua", "a.b", and so on.
 */
export function resolveStyle(theme: Theme, capture: string, lang: string): Style | undefined {
  const parts = capture.split(".");
  for (let n = parts.length; n > 0; n--) {
    const base = parts.slice(0, n).join(".");
    const s = theme.captures[`${base}.${lang}`] ?? theme.captures[base];
    if (s) return s;
  }
  return undefined;
}
