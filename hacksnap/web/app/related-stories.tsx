import { ChevronRight } from "lucide-react";
import { Recommendation } from "./journey-analytics";
import Link from "next/link";
import { categoryURL, type Category } from "../lib/categories";
import type { RelatedStory } from "../lib/data";

import { domain } from "../lib/format";
import { NextStoryLink } from "./story-navigation";

export function RelatedStories({
  category,
  stories,
  currentId,
  pending = false,
}: {
  category?: Category;
  stories: RelatedStory[];
  currentId: string;
  pending?: boolean;
}) {
  const next = stories.filter((story) => story.hn_id !== currentId).slice(0, 2);
  return (
    <section
      className={`related-stories${pending ? " related-stories-pending" : ""}`}
      aria-labelledby="related-stories-heading"
      aria-busy={pending || undefined}
    >
      <h2 id="related-stories-heading">Read next</h2>
      {pending && <div className="related-stories-placeholder" aria-hidden="true" />}
      {next.length > 0 && (
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
                  <span className="related-story-meta">
                    {domain(story.url)} <ChevronRight className="inline-icon" aria-hidden="true" />
                  </span>
                </article>
              </Recommendation>
            </li>
          ))}
        </ul>
      )}
      <Link className="browse-latest-link" href={category ? categoryURL(category) : "/"}>
        {category ? `More in ${category.label}` : "Browse latest stories"}{" "}
        <ChevronRight className="inline-icon" aria-hidden="true" />
      </Link>
    </section>
  );
}
