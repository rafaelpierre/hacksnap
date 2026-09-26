import Link from "next/link";
import { categoryURL, type Category } from "../lib/categories";
import type { RelatedStory } from "../lib/data";

import { domain } from "../lib/format";
import { NextStoryLink } from "./story-navigation";

export function RelatedStories({category, stories, currentId}: {category?: Category; stories: RelatedStory[]; currentId: string}) {
  const next = stories.filter(story => story.hn_id !== currentId).slice(0, 2);
  return <section className="related-stories" aria-labelledby="related-stories-heading">
    <h2 id="related-stories-heading">Read next</h2>
    {next.length > 0 && <ul className="related-story-list">{next.map(story => <li key={story.hn_id}>
      <article>
        {category && <span className="related-topic">{category.label}</span>}
        <h3><NextStoryLink id={story.hn_id}>{story.title}</NextStoryLink></h3>
        <span className="related-story-meta">{domain(story.url)} <span aria-hidden="true">→</span></span>
      </article>
    </li>)}</ul>}
    <Link className="button" href={category ? categoryURL(category) : "/archive"}>
      {category ? `More in ${category.label} →` : "Browse latest stories →"}
    </Link>
  </section>;
}
