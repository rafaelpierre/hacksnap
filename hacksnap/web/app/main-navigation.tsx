"use client";

import { usePathname } from "next/navigation";
import { NavigationPendingLink } from "./navigation-pending-link";

const destinations = [
  {
    href: "/",
    label: "Latest",
    active: (path: string) => path === "/" || /^\/\d{4}\/\d{2}$/.test(path),
  },
  {
    href: "/topics",
    label: "Topics",
    active: (path: string) => path === "/topics" || path.startsWith("/category/"),
  },
  { href: "/about", label: "About", active: (path: string) => path === "/about" },
];

export function MainNavigation() {
  const pathname = usePathname();
  return (
    <nav className="main-navigation" aria-label="Main navigation">
      {destinations.map(({ href, label, active }) => (
        <NavigationPendingLink
          key={href}
          href={href}
          className="header-link"
          aria-current={active(pathname) ? (pathname === href ? "page" : "location") : undefined}
          pendingLabel={`Loading ${label}…`}
        >
          {label}
        </NavigationPendingLink>
      ))}
    </nav>
  );
}
