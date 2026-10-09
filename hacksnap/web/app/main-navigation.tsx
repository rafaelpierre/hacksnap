"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Blocks,
  Building2,
  Code2,
  FlaskConical,
  Menu,
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
  label = "Topic navigation",
  pathname = "",
  category,
}: NavigationProps & { pathname?: string; category?: string | null }) {
  return (
    <nav className="main-navigation" aria-label={label}>
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

function NavigationCategory({ onChange }: { onChange: (category: string | null) => void }) {
  const search = useSearchParams();
  const category = search.get("category");
  useEffect(() => onChange(category), [category, onChange]);
  return null;
}

export function TopicNavigation(props: NavigationProps) {
  const pathname = usePathname();
  const [category, setCategory] = useState<string | null>(null);
  return (
    <>
      {/* Revealing search parameters must not replace a focused navigation link. */}
      <Suspense fallback={null}>
        <NavigationCategory onChange={setCategory} />
      </Suspense>
      <NavigationLinks
        {...props}
        pathname={pathname}
        category={pathname === "/" ? category : null}
      />
    </>
  );
}

function HeaderLinks({
  pathname,
  category,
  mobile,
}: {
  pathname: string;
  category?: string | null;
  mobile: boolean;
}) {
  const latest = !category && (pathname === "/" || /^\/\d{4}\/\d{2}$/.test(pathname));
  return (
    <nav
      className={mobile ? "mobile-main-navigation" : "header-navigation"}
      aria-label="Main navigation"
    >
      <NavigationPendingLink
        href="/"
        className={mobile ? "nav-link" : "header-link"}
        aria-current={latest ? (pathname === "/" ? "page" : "location") : undefined}
        pendingLabel="Loading latest stories…"
      >
        Latest
      </NavigationPendingLink>
      <NavigationPendingLink
        href="/about"
        className={mobile ? "nav-link" : "header-link"}
        aria-current={pathname === "/about" ? "page" : undefined}
        pendingLabel="Loading About…"
      >
        About
      </NavigationPendingLink>
    </nav>
  );
}

export function MainNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const [category, setCategory] = useState<string | null>(null);
  return (
    <>
      <Suspense fallback={null}>
        <NavigationCategory onChange={setCategory} />
      </Suspense>
      <HeaderLinks
        pathname={pathname}
        category={pathname === "/" ? category : null}
        mobile={mobile}
      />
    </>
  );
}

/** Native disclosure preserves mobile navigation before hydration and without JavaScript. */
export function MobileNavigation() {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    setExpanded(details.current?.open ?? false);
  }, []);
  const close = useCallback((returnFocus = false) => {
    if (!details.current?.open) return;
    details.current.open = false;
    setExpanded(false);
    if (returnFocus) summary.current?.focus();
  }, []);

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
        aria-label="Menu"
        aria-expanded={expanded}
        aria-controls="mobile-navigation-panel"
      >
        <Menu className="inline-icon" aria-hidden="true" />
      </summary>
      <Suspense fallback={null}>
        <CloseMenuOnNavigation onNavigate={close} />
      </Suspense>
      <div
        id="mobile-navigation-panel"
        className="mobile-navigation-panel"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) close(true);
        }}
      >
        <MainNavigation mobile />
        <TopicNavigation label="Mobile topics" />
      </div>
    </details>
  );
}

function CloseMenuOnNavigation({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const route = `${pathname}?${search.toString()}`;
  const previousRoute = useRef(route);
  useEffect(() => {
    if (previousRoute.current !== route) onNavigate();
    previousRoute.current = route;
  }, [route, onNavigate]);
  return null;
}
