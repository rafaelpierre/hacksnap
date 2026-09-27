import type { Story, Summary } from "./data";

export function hasReadySummary(story: Story): story is Story & { summary: Summary } {
  return Boolean(story.summary?.overall_takeaway?.trim());
}
