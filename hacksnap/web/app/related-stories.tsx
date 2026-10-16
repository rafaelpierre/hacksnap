import { ArrowRight } from "lucide-react";
import { Recommendation, SectionExposure } from "./journey-analytics";
import Link from "next/link";
import { categoryURL, type Category } from "../lib/categories";
import type { RelatedStory } from "../lib/data";

import { NextStoryLink } from "./story-navigation";
import { briefExcerpt } from "../lib/brief";
import { readingSection } from "../lib/reading-metadata";

export function RelatedStories({
  category,
  stories,
  currentId,
  pending = false,
  unavailable = false,
}: {
  category?: Category;
  stories: RelatedStory[];
  currentId: string;
  pending?: boolean;
  unavailable?: boolean;
}) {
  const next = stories.filter((story) => story.hn_id !== currentId).slice(0, 2);
  return (
    <section
      className={`related-stories detail-section${pending ? " related-stories-pending" : ""}`}
      aria-labelledby="related-stories-heading"
      aria-busy={pending || undefined}
      {...(!pending && !unavailable && next.length > 0 ? readingSection("related") : {})}
    >
      {!pending && <SectionExposure storyId={currentId} section="read_next" />}
      <h2 id="related-stories-heading">Continue reading</h2>
      {pending ? (
        <p className="related-stories-state" role="status">
          Finding more to read…
        </p>
      ) : unavailable ? (
        <p className="related-stories-state" role="status">
          Reading suggestions are temporarily unavailable. Browse the topic for more stories.
        </p>
      ) : next.length === 0 ? (
        <p className="related-stories-state">No further stories yet.</p>
      ) : (
        <ul className="related-story-list">
          {next.map((story, index) => (
            <li key={story.hn_id}>
              <Recommendation source={currentId} target={story.hn_id} position={index + 1}>
                <article>
                  {category && <span className="related-topic">{category.label}</span>}
                  <h3>
                    <NextStoryLink id={story.hn_id} slug={story.story_slug}>
                      {story.title}
                    </NextStoryLink>
                  </h3>
                  {story.takeaway?.trim() && (
                    <p className="feed-excerpt">{briefExcerpt(story.takeaway)}</p>
                  )}
                </article>
              </Recommendation>
            </li>
          ))}
        </ul>
      )}
      <Link className="browse-latest-link" href={category ? categoryURL(category) : "/"}>
        {category ? `More in ${category.label}` : "Browse latest stories"}{" "}
        <ArrowRight className="inline-icon" aria-hidden="true" />
      </Link>
    </section>
  );
}
