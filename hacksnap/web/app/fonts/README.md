# Website fonts

The website bundles variable WOFF2 fonts from Google Fonts:

- Bricolage Grotesque, Latin subset, weights 200–800 and optical sizes 12–96:
  https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9K6as8bTXq_nANBjzKo3IeZx8z6up5BeSl9D4dj_x9PpZBMlGIInHWVyNJ.woff2
- Source Sans 3, Latin subset, weights 200–900:
  https://fonts.gstatic.com/s/sourcesans3/v19/nwpStKy2OAdR1K-IwhWudF-R3w8aZejf5Hc.woff2
- Newsreader upright, Latin subset, weights 200–800 and optical sizes 6–72:
  https://fonts.gstatic.com/s/newsreader/v26/cY9AfjOCX1hbuyalUrK4397yjIJFJpc.woff2
- Newsreader italic, Latin subset, weights 200–800 and optical sizes 6–72:
  https://fonts.gstatic.com/s/newsreader/v26/cY9CfjOCX1hbuyalUrK439vCjohCBJWxZA.woff2

The sans-serif fonts were retrieved 26 September 2026; Newsreader was retrieved
5 October 2026. All are licensed under the SIL Open Font License; the accompanying
OFL files retain their copyright notices. The files are served
by Next.js from the app itself, with no Google Fonts request at build or runtime.
Characters outside these subsets use the system fallback fonts.

Story headlines, card excerpts, article and discussion copy, and related-story
headlines use Newsreader with automatic optical sizing. Story headlines use
weight 600 and reading text uses weight 400, including real italics for emphasis.
The wordmark and general page headings use Bricolage Grotesque at weight 600.
Navigation, labels and metadata use Source Sans 3. Code, ranks, points and
timestamps use the existing system monospace stack.

Open Graph images use local static TTF instances of these same fonts because
Next.js's image renderer does not support WOFF2. The `*-og-*.ttf` files were
converted from the bundled fonts with FontTools: Bricolage Grotesque at weight
600, optical size 96, width 100; Source Sans 3 at weight 400; Newsreader at weight
600, optical size 72 for preview headlines, and weight 400, optical size 26 for
preview excerpts. They retain the same licenses above and need no runtime font
service.
