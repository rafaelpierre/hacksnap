"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function DataUnavailable() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section className="empty" role="status" aria-live="polite">
      <h1>Stories are temporarily unavailable.</h1>
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
