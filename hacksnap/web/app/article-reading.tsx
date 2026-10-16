"use client";

import { Suspense, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { analyticsRouteIdentity, captureReadingVisit } from "../lib/analytics";
import { createArticleReader } from "../lib/article-reading";
import type { ReadingContext, ReadingFields } from "../lib/reading-contract";

export function ArticleReading({
  context,
  sourceURL,
  children,
}: {
  context: ReadingContext;
  sourceURL: string | null;
  children: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  return (
    <article className="detail" ref={root}>
      {children}
      <Suspense fallback={null}>
        <ReadingObserver root={root} context={context} sourceURL={sourceURL} />
      </Suspense>
    </article>
  );
}

function ReadingObserver({
  root,
  context,
  sourceURL,
}: {
  root: RefObject<HTMLElement | null>;
  context: ReadingContext;
  sourceURL: string | null;
}) {
  const saved = useRef<{
    key: string;
    reader: ReturnType<typeof createArticleReader>;
  } | null>(null);
  const path = usePathname();
  const search = useSearchParams();
  const route = analyticsRouteIdentity(path ?? "", search?.toString() ?? "");

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const visit = captureReadingVisit(context);
    if (!visit) return;
    const key = visit.visitId + ":" + context.content_revision;
    if (saved.current?.key !== key)
      saved.current = { key, reader: createArticleReader(element, visit.emit) };
    const reader = saved.current.reader;
    reader.start();
    const interval = window.setInterval(reader.tick, 250);
    function visibility() {
      if (document.visibilityState === "hidden") {
        reader.flush("hidden");
        reader.stop();
      } else reader.activity();
    }
    function blur() {
      reader.flush("blur");
      reader.stop();
    }
    function pagehide() {
      reader.flush("pagehide");
      reader.stop();
    }
    function toggle(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.matches("details[data-reading-theme]")) {
        const heading = target.querySelector("summary");
        if (heading)
          reader.action("article_theme_toggle", heading, {
            action: target.hasAttribute("open") ? "open" : "close",
          });
      } else if (target.matches("[data-reading-sources]")) {
        const state = "newState" in event ? event.newState : undefined;
        if (state === "open" || state === "closed")
          reader.action("article_source_action", target, {
            source_kind: "hn_comment",
            action: state === "open" ? "open" : "close",
          });
      }
    }
    function click(event: MouseEvent) {
      if (
        (event.type === "click" && event.button !== 0) ||
        (event.type === "auxclick" && event.button !== 1)
      )
        return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      let kind: ReadingFields["source_kind"];
      try {
        const url = new URL(link.href, window.location.href);
        if (!["https:", "http:"].includes(url.protocol) || url.origin === window.location.origin)
          return;
        if (url.hostname === "news.ycombinator.com") {
          kind = url.searchParams.get("id") === context.story_id ? "hn_thread" : "hn_comment";
        } else kind = sourceURL && url.href === new URL(sourceURL).href ? "original" : "citation";
      } catch {
        return;
      }
      reader.action("article_source_action", link, { source_kind: kind, action: "click" });
    }
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", reader.activity);
    window.addEventListener("pageshow", reader.activity);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("scroll", reader.activity, { passive: true });
    element.addEventListener("pointerdown", reader.activity, { passive: true });
    element.addEventListener("keydown", reader.activity);
    element.addEventListener("toggle", toggle, true);
    element.addEventListener("click", click, true);
    element.addEventListener("auxclick", click, true);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", reader.activity);
      window.removeEventListener("pageshow", reader.activity);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("scroll", reader.activity);
      element.removeEventListener("pointerdown", reader.activity);
      element.removeEventListener("keydown", reader.activity);
      element.removeEventListener("toggle", toggle, true);
      element.removeEventListener("click", click, true);
      element.removeEventListener("auxclick", click, true);
      reader.flush("route");
      reader.stop();
    };
  }, [context, route, sourceURL, root]);

  return null;
}
