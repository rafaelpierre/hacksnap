import { getReadyStoryPage } from "../../../lib/data";
import { readyStoriesHandler } from "../../../lib/stories-api";

export const dynamic = "force-dynamic";
export const GET = readyStoriesHandler({ getReadyStoryPage });
