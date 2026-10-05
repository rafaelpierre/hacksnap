export type StoryEvent = { kind: "view" | "click"; story_id: string; visit_id: string };

/** Content-free and independent of GA; navigation never waits for collection. */
export function sendStoryEvent(event: StoryEvent): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  try {
    void window
      .fetch("/api/story-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        credentials: "same-origin",
        keepalive: true,
      })
      .catch(() => {
        /* Collection is best effort, without retries. */
      });
  } catch {
    /* A blocked fetch must not interrupt reading or link activation. */
  }
}
