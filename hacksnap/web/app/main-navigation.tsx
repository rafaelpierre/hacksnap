"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  {href: "/", label: "Top stories", active: (path: string) => path === "/"},
  {href: "/archive", label: "Latest", active: (path: string) => path === "/archive" || path.startsWith("/archive/")},
  {href: "/topics", label: "Topics", active: (path: string) => path === "/topics" || path.startsWith("/category/")},
];

export function MainNavigation() {
  const pathname = usePathname();
  return <nav className="main-navigation" aria-label="Main navigation">
    {destinations.map(({href, label, active}) => <Link key={href} href={href}
      className="header-link" aria-current={active(pathname) ? (pathname === href ? "page" : "location") : undefined}>{label}</Link>)}
  </nav>;
}
