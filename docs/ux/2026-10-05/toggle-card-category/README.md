# Card category visibility

Category pages set `showCategory={false}` on the shared feed. Latest and dated
archives keep the default visible label. The category row is omitted entirely
when it has no content.

The production fixture browser suite passed at 320px and 1280px, with 100% and
200% text, under light and dark OS preferences. The app uses its current light-only
appearance in both cases. Assertions cover category labels, horizontal overflow,
responsive images, sticky-header clearance, and automated accessibility checks.

Screenshots here retain Latest and Models & Products examples at each size and
text scale. Jest covers label visibility through initial rendering, continuation,
retry and restored feed history, plus preserving the ranked Archive label.
