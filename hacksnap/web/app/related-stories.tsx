import Link from "next/link";
import { categoryURL, type Category } from "../lib/categories";
import type { RelatedStory } from "../lib/data";
import { LocalTime } from "./local-time";

export function RelatedStories({category, stories}: {category?: Category; stories: RelatedStory[]}) {
  if (!category || stories.length === 0) {
    return <section className="related-stories" aria-labelledby="related-stories-heading">
      <h2 id="related-stories-heading">Keep reading</h2>
      <Link className="button" href="/archive">Browse latest stories →</Link>
    </section>;
  }

  return <section className="related-stories" aria-labelledby="related-stories-heading">
    <h2 id="related-stories-heading">More in {category.label}</h2>
    <ul className="related-story-list">{stories.map(story => <li key={story.hn_id}>
      <article>
        <h3><Link href={`/story/${story.hn_id}`}>{story.title}</Link></h3>
        <p className="feed-excerpt">{story.takeaway}</p>
        <p className="related-story-date">Added <LocalTime dateTime={story.date_added.toISOString()} /></p>
      </article>
    </li>)}</ul>
    <Link className="button" href={categoryURL(category)}>Browse all {category.label} →</Link>
  </section>;
}
