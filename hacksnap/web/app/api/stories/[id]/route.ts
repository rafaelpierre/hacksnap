import { getLeaderboard, getStory } from "../../../../lib/data";
import { storiesHandlers } from "../../../../lib/stories-api";

export const dynamic = "force-dynamic";
const handlers = storiesHandlers({getLeaderboard, getStory});

export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  return handlers.detail((await params).id);
}
