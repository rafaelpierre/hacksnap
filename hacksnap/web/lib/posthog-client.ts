import { PostHog, type PostHogConfig } from "posthog-js";
import { analyticsAllowed } from "./analytics-consent";
import {
  analyticsPageContext,
  maskReplayAttribute,
  publicAnalyticsURL,
  scrubAnalyticsProperties,
} from "./analytics-privacy";

export function posthogConfig(
  sessionContext: () => Record<string, string> = () => ({}),
): Partial<PostHogConfig> {
  return {
    api_host: "https://eu.i.posthog.com",
    ui_host: "https://eu.posthog.com",
    defaults: "2026-05-30",
    get_current_url: () => publicAnalyticsURL(window.location.href),
    debug: false,
    persistence: "localStorage",
    persistence_save_debounce_ms: 0,
    cross_subdomain_cookie: false,
    person_profiles: "never",
    capture_pageview: false,
    capture_pageleave: false,
    capture_heatmaps: true,
    autocapture: { dom_event_allowlist: ["click"], capture_copied_text: false },
    mask_all_text: true,
    mask_all_element_attributes: true,
    save_campaign_params: false,
    save_referrer: false,
    disable_capture_url_hashes: true,
    capture_exceptions: false,
    capture_performance: { web_vitals: true, network_timing: false },
    enable_recording_console_log: false,
    disable_surveys: true,
    disable_conversations: true,
    disable_product_tours: true,
    disable_web_experiments: true,
    session_idle_timeout_seconds: 1800,
    session_recording: {
      maskAllInputs: true,
      blockSelector:
        ".share-panel, .share-manual, [data-analytics-private], input[type=hidden], input[type=file]",
      maskAttributeFn: maskReplayAttribute,
      captureJsonLd: false,
      recordHeaders: false,
      recordBody: false,
      recordCrossOriginIframes: false,
      sampleRate: 0.1,
      maskCapturedNetworkRequestFn: (request) => ({
        ...request,
        name: publicAnalyticsURL(request.name),
      }),
    },
    before_send: (event) => {
      if (!analyticsAllowed()) return null;
      event.properties = scrubAnalyticsProperties({
        ...analyticsPageContext(),
        ...event.properties,
        ...sessionContext(),
        app: "hacksnap",
        contract_version: 3,
      });
      return event;
    },
  };
}

export function createPostHogClient() {
  const posthog = new PostHog();
  posthog.init(
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!,
    posthogConfig((): Record<string, string> => {
      const session = posthog.get_session_id();
      try {
        const firstKey = "hacksnap:analytics-first-session";
        const first = localStorage.getItem(firstKey) ?? session;
        localStorage.setItem(firstKey, first);
        const landingKey = "hacksnap:analytics-landing";
        const stored = JSON.parse(localStorage.getItem(landingKey) ?? "null");
        const landing =
          stored?.session === session &&
          ["story", "feed", "topics", "archive", "other"].includes(stored.type)
            ? String(stored.type)
            : analyticsPageContext().route_type;
        localStorage.setItem(landingKey, JSON.stringify({ session, type: landing }));
        return {
          reader_type: first === session ? "first_observed" : "returning",
          landing_page_type: landing,
        };
      } catch {
        return {};
      }
    }),
  );
  return {
    capture(name: string, properties: Record<string, string | number>) {
      if (analyticsAllowed()) posthog.capture(name, properties);
    },
    stop() {
      posthog.opt_out_capturing();
      posthog.stopSessionRecording();
      posthog.set_config({
        autocapture: false,
        capture_heatmaps: false,
        capture_performance: false,
        disable_session_recording: true,
        disable_persistence: true,
      });
      // SDK 1.438.12 has no discard-only shutdown: shutdown() flushes queues.
      // Close its dispatch gate so pending batches and late retries are dropped.
      // Keep the dependency pinned and the real-SDK withdrawal regression test.
      posthog.__loaded = false;
    },
  };
}
