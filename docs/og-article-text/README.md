# Article OG preview verification

The PNGs were rendered locally with the existing `lib/og-image.tsx` renderer and
bundled fonts. Article text and `example.com` are synthetic test fixtures, not
production articles. No database, publisher image, or external font service was used.

- `home.png`: unchanged homepage branding, matching the supplied light-theme reference.
- `article.png`: article title, source domain, and takeaway subtitle.
- `long-headline.png`: wrapped headline and multi-line subtitle remain above the footer.
- `pending-summary.png`: title and source remain visible without a subtitle.

All images are 1200×630. Visual inspection confirmed the gray canvas, white card,
charcoal headings, blue source/domain accents, logo, spacing, and footer. The
renderer itself was unchanged; this fix restores its article inputs and metadata URLs.
