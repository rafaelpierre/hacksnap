export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "hacksnap-theme";

export function themePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

// Runs synchronously in <head>, before CSS paints cached or fresh HTML.
// System mode is resolved by CSS, including subsequent OS appearance changes.
export const themeInitScript = `
  (() => {
    let preference = "system";
    try {
      const saved = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
      if (saved === "light" || saved === "dark") preference = saved;
    } catch {}
    document.documentElement.dataset.theme = preference;
  })();
`;
