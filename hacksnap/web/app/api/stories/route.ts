import { getLeaderboard, getStory } from "../../../lib/data";
import { storiesHandlers } from "../../../lib/stories-api";

export const dynamic = "force-dynamic";
export const GET = storiesHandlers({getLeaderboard, getStory}).list;
