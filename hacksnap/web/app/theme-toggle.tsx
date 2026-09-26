"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);
    try {
      localStorage.setItem("hacksnap-theme", nextTheme);
    } catch {
      // Switching still works when the browser blocks persistent storage.
    }
  }

  const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
  return <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={label} title={label}>
    <Sun className="theme-icon-light" size={18} aria-hidden="true" />
    <Moon className="theme-icon-dark" size={18} aria-hidden="true" />
  </button>;
}
