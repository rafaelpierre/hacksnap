"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY, themePreference, type ThemePreference } from "../lib/theme";

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setPreference(themePreference(document.documentElement.dataset.theme));
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => setSystemDark(media.matches);
    syncSystem();
    media.addEventListener("change", syncSystem);

    function syncPreference(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      const next = themePreference(event.newValue);
      document.documentElement.dataset.theme = next;
      setPreference(next);
    }
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener("storage", syncPreference);
      media.removeEventListener("change", syncSystem);
    };
  }, []);

  function changePreference(value: string) {
    const next = themePreference(value);
    document.documentElement.dataset.theme = next;
    setPreference(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Keep the selection for this page session when storage is unavailable.
    }
  }

  const dark = preference === "dark" || (preference === "system" && systemDark);
  const label = `Switch to ${dark ? "light" : "dark"} mode`;

  return <button type="button" className="theme-control theme-toggle"
    aria-label={label} title={label}
    onClick={() => changePreference(dark ? "light" : "dark")}>
    <Sun className="theme-sun" size={18} strokeWidth={1.75} aria-hidden="true" />
    <Moon className="theme-moon" size={18} strokeWidth={1.75} aria-hidden="true" />
  </button>;
}
