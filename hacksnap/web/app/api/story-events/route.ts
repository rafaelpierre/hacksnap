import { createStoryEventHandler, storyEventBudget } from "../../../lib/story-events";
import { recordStoryEvent, storyEventsEnabled } from "../../../lib/story-events-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createStoryEventHandler({
  enabled: storyEventsEnabled,
  allow: storyEventBudget(),
  record: recordStoryEvent,
});
