import { FixtureImage } from "./fixture-image";

export default async function PerfImage({
  searchParams,
}: {
  searchParams: Promise<{ count?: string; mode?: string; detail?: string }>;
}) {
  const query = await searchParams;
  const count = query.count === "30" ? 30 : 10;
  const optimized = query.mode === "optimized";
  if (query.detail === "1")
    return (
      <article className="detail">
        <header className="story-header">
          <h1>Representative article image fixture</h1>
          <p className="standfirst">
            A fixed headline and summary hold the reading layout constant while the image delivery
            changes.
          </p>
          <FixtureImage index={0} detail optimized={optimized} />
        </header>
      </article>
    );
  return (
    <div className="browse-layout">
      <aside aria-hidden="true" />
      <div className="browse-content">
        <div className="home-intro">
          <h1>Fixed image fixture</h1>
        </div>
        <ol className="story-list">
          {Array.from({ length: count }, (_, index) => (
            <li key={index}>
              <article className="story-row feed-story">
                <div className="story-domain story-context">AI</div>
                <h3>Representative story {index + 1} with a consistent headline</h3>
                <FixtureImage index={index} detail={false} optimized={optimized} />
                <div className="story-content">
                  <p className="feed-excerpt">
                    A fixed summary keeps the card height and visible content consistent for every
                    image.
                  </p>
                  <div className="feed-story-footer">
                    <span>123 points · 45 comments</span>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
