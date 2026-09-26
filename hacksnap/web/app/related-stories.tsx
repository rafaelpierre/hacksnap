import Link from "next/link";
import { categoryURL, type Category } from "../lib/categories";
import type { RelatedStory } from "../lib/data";
import { LocalTime } from "./local-time";
import { NextStoryLink } from "./story-navigation";

export function RelatedStories({category, stories, currentId}: {category?: Category; stories: RelatedStory[]; currentId: string}) {
  const next = stories.filter(story => story.hn_id !== currentId).slice(0, 2);
  return <section className="related-stories" aria-labelledby="related-stories-heading">
    <h2 id="related-stories-heading">Read next</h2>
    {next.length > 0 && <ul className="related-story-list">{next.map(story => <li key={story.hn_id}>
      <article>
        <h3><NextStoryLink id={story.hn_id} sourceId={currentId}>{story.title}</NextStoryLink></h3>
        <p className="feed-excerpt">{story.takeaway}</p>
        <p className="related-story-date">Added <LocalTime dateTime={story.date_added.toISOString()} /></p>
      </article>
    </li>)}</ul>}
    <Link className="button" href={category ? categoryURL(category) : "/archive"}>
      {category ? `More in ${category.label} →` : "Browse latest stories →"}
    </Link>
  </section>;
}
