import styles from "./browse-loading.module.css";

function SkeletonCard() {
  return (
    <li>
      <article className="story-row feed-story">
        <div className="story-domain story-context">
          <span className={`${styles.bone} ${styles.topic}`} />
        </div>
        <div className="feed-story-image">
          <span className={`${styles.bone} ${styles.image}`} />
        </div>
        <div className="story-content">
          <h3 className={styles.title}>
            <span className={`${styles.bone} ${styles.titleFirst}`} />
            <span className={`${styles.bone} ${styles.titleSecond}`} />
          </h3>
          <p className={styles.excerpt}>
            <span className={`${styles.bone} ${styles.excerptFirst}`} />
            <span className={`${styles.bone} ${styles.excerptSecond}`} />
          </p>
          <div className="feed-story-footer">
            <span className={`${styles.bone} ${styles.meta}`} />
            <span className={`${styles.bone} ${styles.actions}`} />
          </div>
        </div>
      </article>
    </li>
  );
}

export function BrowseLoading() {
  return (
    <section aria-label="Stories are loading">
      <p role="status" aria-live="polite" className={styles.status}>
        Loading stories…
      </p>
      <ol className="story-list" aria-hidden="true" aria-busy="true">
        {Array.from({ length: 3 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </ol>
    </section>
  );
}
