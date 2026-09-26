"use client";

import { track } from "../lib/analytics";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { browseLabel, validBrowseContext, type BrowseContext } from "../lib/navigation-context";

const PREFIX = "hacksnap:journey:";
const RESTORE_KEY = "hacksnap:pending-return";
const TAB_PREFIX = "hacksnap-tab:";

function storage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

function currentTabId(): string | null {
  return window.name.startsWith(TAB_PREFIX) ? window.name : null;
}

function readJourney(token: string | null): BrowseContext | null {
  if (!token || !/^[0-9a-f-]{36}$/.test(token)) return null;
  const store = storage();
  const tabId = currentTabId();
  if (!store || !tabId) return null;
  try {
    const record = JSON.parse(store.getItem(PREFIX + token) ?? "null");
    return record?.tabId === tabId ? validBrowseContext(record.context) : null;
  } catch { return null; }
}

function journeyToken(): string | null {
  return new URLSearchParams(window.location.search).get("journey");
}

function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}

export function BrowseStoryLink({id, children}: {id: string; children: ReactNode}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `/story/${id}`;
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!plainClick(event)) return;
    let destination = href;
    const store = storage();
    const url = window.location.pathname + window.location.search;
    const label = browseLabel(url);
    if (store && label && typeof window.crypto?.randomUUID === "function") {
      try {
        if (!currentTabId()) window.name = TAB_PREFIX + crypto.randomUUID();
        const token = crypto.randomUUID();
        const context: BrowseContext = {url, label, scrollY: window.scrollY, savedAt: Date.now()};
        store.setItem(PREFIX + token, JSON.stringify({tabId: currentTabId(), context}));
        destination = `${href}?journey=${token}`;
      } catch { /* Use the canonical destination when storage is unavailable. */ }
    }
    event.preventDefault();
    startTransition(() => router.push(destination));
  }
  return <><Link href={href} onClick={open} aria-busy={pending || undefined}>{children}</Link>
    {pending && <span className="navigation-pending" role="status">Opening story…</span>}</>;
}

export function NextStoryLink({id, children}: {id: string; children: ReactNode}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `/story/${id}`;
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!plainClick(event)) return;
    const token = journeyToken();
    const destination = readJourney(token) ? `${href}?journey=${token}` : href;
    event.preventDefault();
    startTransition(() => router.push(destination));
  }
  return <><Link href={href} onClick={open} aria-busy={pending || undefined}>{children}</Link>
    {pending && <span className="navigation-pending" role="status">Opening story…</span>}</>;
}

export function StoryReturnLink() {
  const router = useRouter();
  const [context, setContext] = useState<BrowseContext | null>(null);
  useEffect(() => { setContext(readJourney(journeyToken())); }, []);
  function rememberReturn(event: MouseEvent<HTMLAnchorElement>) {
    track("story_return");
    if (!plainClick(event)) return;
    if (context && !validBrowseContext(context)) {
      event.preventDefault();
      setContext(null);
      router.push("/");
      return;
    }
    const store = storage();
    if (!context || !store) return;
    try { store.setItem(RESTORE_KEY, JSON.stringify({tabId: currentTabId(), context})); } catch { /* The link still returns to the list. */ }
  }
  return <Link className="back-link" href={context?.url ?? "/"} scroll={!context} onClick={rememberReturn}>
    ← {context ? context.label : "Top stories"}
  </Link>;
}

export function ListPositionRestorer() {
  useEffect(() => {
    const store = storage();
    if (!store) return;
    let record: {tabId?: string; context?: unknown} | null = null;
    try {
      record = JSON.parse(store.getItem(RESTORE_KEY) ?? "null");
    } catch { return; }
    const context = record?.tabId === currentTabId() ? validBrowseContext(record?.context) : null;
    if (!context || context.url !== window.location.pathname + window.location.search) return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({top: context.scrollY, behavior: "auto"});
      store.removeItem(RESTORE_KEY);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}
