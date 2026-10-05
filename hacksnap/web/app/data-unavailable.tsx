"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function DataUnavailable({ headingLevel = 1 }: { headingLevel?: 1 | 2 } = {}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className="empty" role="status" aria-live="polite">
      <Heading>Stories are temporarily unavailable.</Heading>
      <p>Please try again shortly. You can still browse topics and learn about Hacksnap.</p>
      <button
        className="button primary"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? "Trying again…" : "Try again"}
      </button>
    </section>
  );
}
