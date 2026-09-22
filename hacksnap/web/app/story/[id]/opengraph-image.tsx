import { notFound } from "next/navigation";
import { getStory } from "../../../lib/data";
import { domain } from "../../../lib/format";
import { ogImage } from "../../../lib/og-image";

export const alt = "Hacksnap story — article brief and Hacker News discussion highlights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 1800;

export default async function Image({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const story = await getStory(id);
  if (!story) notFound();
  return ogImage({
    title: story.title,
    source: domain(story.url),
    indicators: {
      sentiment: story.summary?.sentiment ?? null,
      noComments: story.summary?.source_coverage.included_comments === 0,
      history: story.rank_history ?? [],
      asOf: story.observed_at ?? new Date().toISOString(),
      currentRank: story.rank,
    },
  });
}
