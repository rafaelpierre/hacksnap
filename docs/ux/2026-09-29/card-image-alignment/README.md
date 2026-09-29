# Feed card alignment verification

Category and rank occupy the full-width first row. Image and title share the
second row. Cards with less than 36rem of content width give the excerpt,
discussion themes and footer the full width while retaining the title beside
the thumbnail. Container sizing accounts for both sidebar width and enlarged text.

Browser measurements cover 320, 375, 640, 641, 768, 1024, 1280 and 1920 CSS pixels,
light and dark themes, and 100%/200% root text size (32 combinations). Four real
StoryRow fixtures cover ranked and unranked cards, missing images, failed images,
missing categories, pending summaries, and discussion themes.

All combinations have matching image/title top coordinates, category context
above both, and no card or document horizontal overflow. See `results.json` and
`fallback-results.json`. The successful-image pass substitutes two local SVG
fixtures in the real image wrappers; it does not verify remote image delivery.
The fallback pass uses the hydrated ArticleImage error state. No production data
or assets were changed. Temporary fixture route and preview server were removed.

Keyboard Tab order remains category, story title, comments, Share. The thumbnail
is decorative and adds no focus target. Category, comment and Share controls
retain their existing minimum 44px touch targets. Missing-image and pending
states retain readable full-width text. Loading uses the same reserved image
wrapper and aspect ratio as the successful state.

Screenshots include mobile and desktop in both themes at both text sizes, plus
focused light-theme card views. The wider card uses parallel image/content
columns; narrow cards place the excerpt and discussion below the image/title row.
