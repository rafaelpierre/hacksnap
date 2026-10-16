"use client";

import { DataUnavailable } from "../../data-unavailable";

// The ISR error propagates to Next (retaining any successful cached page), while
// a cold request keeps the existing recoverable unavailable presentation.
export default function StoryError() {
  return <DataUnavailable />;
}
