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

After applying the popularity and activation-state migrations, and **before enabling first-party
tracking**, set `HACKSNAP_IMPORT_DATABASE_URL` through your secret manager to a
server-only connection with TLS, SELECT on `hacker_news_threads` and the popularity
tables, INSERT/UPDATE on `hacksnap_story_popularity`, SELECT/UPDATE on
`hacksnap_popularity_state`, and privileges to lock these three popularity tables.
Hosted Supabase connections use `verify-full` with the bundled
website CA, preserving an explicitly supplied `sslrootcert`. Other database
connections must require TLS. Do not use the website reader connection. Import with:

```sh
uv run python -m hn_trending.import_story_views seeds/story-page-views-2026-10-05.csv --apply
```

Once the baseline is final, record tracking activation and freeze it **before**
provisioning the writer role's LOGIN credentials or enabling
`HACKSNAP_POPULARITY_DATABASE_URL` on the website:

```sh
uv run python -m hn_trending.import_story_views seeds/story-page-views-2026-10-05.csv --apply --activate-tracking
```

You can also use the second command for the initial import. Baseline replacement
and the activation marker commit together. Unknown IDs or any other failure roll
back both. The writer refuses collection until activation is recorded. Repeating
activation with the identical snapshot preserves the original marker timestamp;
disabling and re-enabling the writer does not reopen the baseline.

The importer validates every stored ID and saved slug before writing, then replaces
only historical counts in one transaction. It never increments the baseline or
changes first-party views/clicks. An identical reapply is a no-op. A different
historical source cannot silently replace an existing baseline.

Refresh the export immediately before activating tracking when possible. Visits
between this snapshot and first-party activation are an unmeasured gap; the
import timestamp does not recover them. If a precise GA cutoff is known, append
`--through` with its actual ISO 8601 timestamp and timezone. Do not substitute the
current time or infer a timestamp from this filename.

After activation, every new or changed historical baseline is rejected, regardless
of `--through`. Only an identical reapply is allowed. This protects the interval
before the first receipt arrives: a browser can emit a GA page view before an
export cutoff and deliver its first-party POST after that cutoff. Receipt time
cannot prove when the page was viewed, and `--through` records provenance only.
Existing live counters, any event receipts, or an already provisioned writer LOGIN
also freeze imports if an activation marker is absent; do not retrofit a guessed
activation time. An existing LOGIN with no receipts cannot prove collection was
inactive, including when an older deployed API has a request in flight. Legacy collection
or writer LOGIN found by the activation-state migration is conservatively frozen, with a migration
marker that is not asserted to be the original collection start time.
Do not remove the marker, delete receipts, or toggle LOGIN to bypass a frozen
baseline. NOLOGIN does not terminate existing writer connections and cannot
establish that no earlier browser view or delayed request exists.

Other exports must contain exactly `path,views` or `story_id,views`. Values are
unformatted positive integers, without GA percentages or separators. Numeric
and valid saved-slug paths for one story are summed with an explicit merge message;
duplicate source paths fail. Absolute URLs must belong to `hacksnap.live`.
Dry run validates CSV values only; `--apply` also checks database identities,
cutoffs and current provenance. No importer is run automatically during deployment.
