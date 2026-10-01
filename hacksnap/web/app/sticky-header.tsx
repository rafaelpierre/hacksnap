"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function StickyHeader({ children }: { children: ReactNode }) {
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const update = () => {
      document.documentElement.style.setProperty(
        "--site-header-height",
        `${element.getBoundingClientRect().height}px`,
      );
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--site-header-height");
    };
  }, []);
  return (
    <header ref={header} className="site-header">
      {children}
    </header>
  );
}
