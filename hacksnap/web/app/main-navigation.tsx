"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Blocks,
  Building2,
  Code2,
  FlaskConical,
  Info,
  Menu,
  Newspaper,
  Server,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { CATEGORIES, categoryURL, type CategoryId } from "../lib/categories";
import { NavigationPendingLink } from "./navigation-pending-link";

const topicIcons: Record<CategoryId, LucideIcon> = {
  models_products: Blocks,
  agents_coding: Code2,
  research_evaluation: FlaskConical,
  infrastructure_efficiency: Server,
  safety_privacy: ShieldCheck,
  industry_society: Building2,
};

type NavigationProps = {
  active?: CategoryId | "home";
  label?: string;
};

function NavigationLinks({
  active,
  label = "Main navigation",
  pathname = "",
  category,
}: NavigationProps & { pathname?: string; category?: string | null }) {
  const latest =
    active === "home" ||
    (!active && !category && (pathname === "/" || /^\/\d{4}\/\d{2}$/.test(pathname)));
  return (
    <nav className="main-navigation" aria-label={label}>
      <div className="nav-main">
        <NavigationPendingLink
          href="/"
          className="nav-link"
          aria-current={
            latest ? (pathname === "/" || active === "home" ? "page" : "location") : undefined
          }
          pendingLabel="Loading latest stories…"
        >
          <Newspaper className="inline-icon topic-icon" aria-hidden="true" />
          <span>Latest</span>
        </NavigationPendingLink>
        <NavigationPendingLink
          href="/about"
          className="nav-link"
          aria-current={pathname === "/about" ? "page" : undefined}
          pendingLabel="Loading About…"
        >
          <Info className="inline-icon topic-icon" aria-hidden="true" />
          <span>About</span>
        </NavigationPendingLink>
      </div>
      <h2 className="nav-heading">
        <NavigationPendingLink
          href="/topics"
          aria-current={pathname === "/topics" ? "page" : undefined}
          pendingLabel="Loading topics…"
        >
          Browse by topic
        </NavigationPendingLink>
      </h2>
      <div className="topic-list">
        {CATEGORIES.map((topic) => {
          const Icon = topicIcons[topic.id];
          const selected = active === topic.id || (!active && category === topic.slug);
          return (
            <NavigationPendingLink
              key={topic.id}
              href={categoryURL(topic)}
              className="nav-link topic-link"
              aria-current={selected ? "page" : undefined}
              pendingLabel={`Loading ${topic.label}…`}
            >
              <Icon className="inline-icon topic-icon" aria-hidden="true" />
              <span className="topic-label">{topic.label}</span>
            </NavigationPendingLink>
          );
        })}
      </div>
    </nav>
  );
}

function RouteNavigation({ pathname, ...props }: NavigationProps & { pathname: string }) {
  const search = useSearchParams();
  const category = pathname === "/" ? search.get("category") : null;
  return <NavigationLinks {...props} pathname={pathname} category={category} />;
}

export function MainNavigation(props: NavigationProps) {
  const pathname = usePathname();
  return (
    <Suspense fallback={<NavigationLinks {...props} pathname={pathname} />}>
      <RouteNavigation {...props} pathname={pathname} />
    </Suspense>
  );
}

/** Native disclosure preserves mobile navigation before hydration and without JavaScript. */
export function MobileNavigation() {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<boolean | undefined>(undefined);
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  function close(returnFocus = false) {
    if (!details.current?.open) return;
    details.current.open = false;
    setExpanded(false);
    if (returnFocus) summary.current?.focus();
  }

  useEffect(() => {
    const element = details.current;
    if (element && previousPathname.current !== pathname) element.open = false;
    previousPathname.current = pathname;
    setExpanded(element?.open ?? false);
  }, [pathname]);

  return (
    <details
      ref={details}
      className="mobile-navigation"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && details.current?.open) {
          event.preventDefault();
          close(true);
        }
      }}
    >
      <summary
        ref={summary}
        className="menu-button"
        aria-expanded={expanded}
        aria-controls="mobile-navigation-panel"
      >
        <Menu className="inline-icon" aria-hidden="true" />
        <span>Topics &amp; menu</span>
      </summary>
      <div
        id="mobile-navigation-panel"
        className="mobile-navigation-panel"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) close(true);
        }}
      >
        <MainNavigation label="Mobile navigation" />
      </div>
    </details>
  );
}
