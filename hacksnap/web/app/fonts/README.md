# Website fonts

The website bundles upright variable WOFF2 fonts from Google Fonts:

- Bricolage Grotesque, Latin subset, weights 200–800 and optical sizes 12–96:
  https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9K6as8bTXq_nANBjzKo3IeZx8z6up5BeSl9D4dj_x9PpZBMlGIInHWVyNJ.woff2
- Source Sans 3, Latin subset, weights 200–900:
  https://fonts.gstatic.com/s/sourcesans3/v19/nwpStKy2OAdR1K-IwhWudF-R3w8aZejf5Hc.woff2

Retrieved 26 September 2026. Both are licensed under the SIL Open Font License;
the accompanying OFL files retain their copyright notices. The files are served
by Next.js from the app itself, with no Google Fonts request at build or runtime.
Characters outside these subsets use the system fallback fonts.

Headlines and the wordmark use Bricolage Grotesque at weight 600. Reading text,
navigation and labels use Source Sans 3. Code, ranks, points and timestamps use
the existing system monospace stack.
