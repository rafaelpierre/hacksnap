# Historical story page views

`story-page-views-2026-10-05.csv` transcribes the six `/story/...` rows from the
user-supplied GA standard **Views** table. It contains 392 views. Homepage,
archive, preview and category paths, Active users and Event count are excluded.
These are page views, not the custom `story_view` event or link clicks.

The user described the report as all collected history since website deployment.
Neither the deployment timestamp nor the precise export cutoff was supplied.
The filename records the date supplied in this conversation; it is not an asserted
GA end timestamp. The report showed ten rows overall, so this seed preserves all
six supplied story paths and makes no claim about unsupplied report rows.

From `data/`, preview without a database connection:

```sh
uv run python -m hn_trending.import_story_views seeds/story-page-views-2026-10-05.csv
```

After applying the popularity migration, and **before enabling first-party
tracking**, set `HACKSNAP_IMPORT_DATABASE_URL` through your secret manager to a
server-only connection with TLS, SELECT on `hacker_news_threads` and the popularity
tables, INSERT/UPDATE on `hacksnap_story_popularity`, and privileges to lock the two
popularity tables. Hosted Supabase connections use `verify-full` with the bundled
website CA, preserving an explicitly supplied `sslrootcert`. Other database
connections must require TLS. Do not use the website reader connection. Import with:

```sh
uv run python -m hn_trending.import_story_views seeds/story-page-views-2026-10-05.csv --apply
```

The importer validates every stored ID and saved slug before writing, then replaces
only historical counts in one transaction. It never increments the baseline or
changes first-party views/clicks. An identical reapply is a no-op. A different
historical source cannot silently replace an existing baseline.

Refresh the export immediately before activating tracking when possible. Visits
between this snapshot and first-party activation are an unmeasured gap; the
import timestamp does not recover them. If a precise GA cutoff is known, append
`--through` with its actual ISO 8601 timestamp and timezone. Do not substitute the
current time or infer a timestamp from this filename.

Once first-party views exist, changing the baseline requires a known cutoff no
later than the earliest view receipt. An established cutoff cannot be moved after
activation. A baseline originally imported with an unknown cutoff can be reapplied
unchanged, but cannot be corrected after activation without investigating the
historical boundary separately. This deliberately avoids guessing overlap.

Other exports must contain exactly `path,views` or `story_id,views`. Values are
unformatted positive integers, without GA percentages or separators. Numeric
and valid saved-slug paths for one story are summed with an explicit merge message;
duplicate source paths fail. Absolute URLs must belong to `hacksnap.live`.
Dry run validates CSV values only; `--apply` also checks database identities,
cutoffs and current provenance. No importer is run automatically during deployment.
