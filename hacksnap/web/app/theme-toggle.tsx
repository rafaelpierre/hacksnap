"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY, themePreference, type ThemePreference } from "../lib/theme";

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    setPreference(themePreference(document.documentElement.dataset.theme));

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
    return () => window.removeEventListener("storage", syncPreference);
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

  return <label className="theme-control">
    <span className="sr-only">Appearance</span>
    <select className="theme-toggle" value={preference}
      onChange={event => changePreference(event.target.value)}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>;
}
