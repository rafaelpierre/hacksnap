"""Preview or atomically replace a historical GA page-view baseline."""

import csv
from dataclasses import dataclass
from datetime import datetime, timezone
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

import click
import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row

MAX_BIGINT = 2**63 - 1
SOURCE = "ga_page_views"
NUMERIC_ID = re.compile(r"[1-9][0-9]{0,14}\Z")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*-([1-9][0-9]{0,14})\Z")


@dataclass(frozen=True)
class ViewRow:
    story_id: int
    views: int
    token: str


@dataclass(frozen=True)
class ViewImport:
    rows: tuple[ViewRow, ...]
    totals: dict[int, int]


def story_token(value: str, *, is_id: bool = False) -> tuple[int, str]:
    """Use the bounded numeric/slug format in web/lib/story-url.ts."""
    if value != value.strip():
        raise ValueError("Story identifiers cannot have surrounding whitespace.")
    if is_id:
        token = value
    else:
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc:
            if (parsed.scheme not in {"http", "https"}
                    or parsed.netloc != "hacksnap.live"):
                raise ValueError("Story URLs must belong to hacksnap.live.")
        if not parsed.path.startswith("/story/"):
            raise ValueError("Only /story/... pages may be imported.")
        token = parsed.path.removeprefix("/story/")
    if NUMERIC_ID.fullmatch(token):
        return int(token), token
    match = SLUG.fullmatch(token) if not is_id and len(token) <= 96 else None
    if match:
        return int(match.group(1)), token
    raise ValueError("Invalid story ID or story URL slug.")


def read_import(path: Path) -> ViewImport:
    rows: list[ViewRow] = []
    totals: dict[int, int] = {}
    seen: set[str] = set()
    with path.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        fields = reader.fieldnames
        if fields not in (["path", "views"], ["story_id", "views"]):
            raise ValueError("CSV columns must be path,views or story_id,views.")
        key = fields[0]
        for line, row in enumerate(reader, 2):
            try:
                if None in row or row[key] is None or row["views"] is None:
                    raise ValueError("Each row must contain exactly two values.")
                story_id, token = story_token(row[key], is_id=key == "story_id")
                raw_views = row["views"]
                if not re.fullmatch(r"[1-9][0-9]*", raw_views) or len(raw_views) > 19:
                    raise ValueError("Views must be exact positive integers, without formatting.")
                views = int(raw_views)
                if views > MAX_BIGINT or totals.get(story_id, 0) + views > MAX_BIGINT:
                    raise ValueError("Views exceed the PostgreSQL bigint limit.")
                # Absolute and relative versions of the same page are duplicates;
                # numeric and stored-slug pages are different GA source paths.
                if token in seen:
                    raise ValueError("Duplicate source story path; remove duplicate rows.")
                seen.add(token)
                rows.append(ViewRow(story_id, views, token))
                totals[story_id] = totals.get(story_id, 0) + views
            except ValueError as error:
                raise ValueError(f"CSV row {line}: {error}") from error
    if not rows:
        raise ValueError("CSV has no story page rows.")
    return ViewImport(tuple(rows), totals)


def parse_through(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("--through must be an ISO 8601 timestamp with a timezone.") from error
    if parsed.tzinfo is None:
        raise ValueError("--through must include a timezone offset or Z.")
    parsed = parsed.astimezone(timezone.utc)
    if parsed > datetime.now(timezone.utc):
        raise ValueError("--through cannot be in the future.")
    return parsed


UPSERT = """
INSERT INTO public.hacksnap_story_popularity
    (story_id, historical_views, historical_source, historical_imported_at, historical_through)
VALUES (%s, %s, %s, CURRENT_TIMESTAMP, %s)
ON CONFLICT (story_id) DO UPDATE SET
    historical_views = EXCLUDED.historical_views,
    historical_source = EXCLUDED.historical_source,
    historical_imported_at = EXCLUDED.historical_imported_at,
    historical_through = EXCLUDED.historical_through
"""


def apply_import(database_url: str, snapshot: ViewImport, through: datetime | None) -> int:
    options = conninfo_to_dict(database_url)
    sslmode = options.get("sslmode", "require")
    hosted_supabase = options.get("host", "").endswith((".pooler.supabase.com", ".supabase.co"))
    tls_options = {"sslmode": sslmode}
    if hosted_supabase:
        tls_options["sslmode"] = "verify-full"
        # Match the website's public CA without depending on the command's cwd.
        tls_options["sslrootcert"] = options.get("sslrootcert") or str(
            Path(__file__).resolve().parents[3] / "hacksnap/web/certs/supabase-ca.crt")
        if not Path(tls_options["sslrootcert"]).is_file():
            raise ValueError("Supabase TLS CA is missing; configure sslrootcert explicitly.")
    elif sslmode not in {"require", "verify-ca", "verify-full"}:
        raise ValueError("HACKSNAP_IMPORT_DATABASE_URL must require TLS.")
    with psycopg.connect(database_url, **tls_options, connect_timeout=10,
                         row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            # Protect the earliest-event check from a simultaneous first event.
            # Read-only website queries remain available during this brief import.
            cursor.execute("SET LOCAL lock_timeout = '5s'")
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute("LOCK TABLE public.hacksnap_popularity_events, "
                           "public.hacksnap_story_popularity IN SHARE ROW EXCLUSIVE MODE")
            cursor.execute("SELECT hn_id, story_slug FROM public.hacker_news_threads "
                           "WHERE hn_id = ANY(%s)", (list(snapshot.totals),))
            stored = {row["hn_id"]: row["story_slug"] for row in cursor.fetchall()}
            unknown = sorted(snapshot.totals.keys() - stored.keys())
            if unknown:
                raise ValueError("Unknown stored story IDs: " + ", ".join(map(str, unknown)))
            for row in snapshot.rows:
                if not NUMERIC_ID.fullmatch(row.token) and stored[row.story_id] != row.token:
                    raise ValueError(f"Slug is not the stored canonical slug for story {row.story_id}.")
            cursor.execute("SELECT story_id, historical_views, historical_source, historical_through "
                           "FROM public.hacksnap_story_popularity WHERE story_id = ANY(%s)",
                           (list(snapshot.totals),))
            existing = {row["story_id"]: row for row in cursor.fetchall()}
            changed = []
            for story_id, views in sorted(snapshot.totals.items()):
                old = existing.get(story_id)
                if old and old["historical_source"] not in {None, SOURCE}:
                    raise ValueError(f"Story {story_id} already has a different historical source.")
                if old and (old["historical_views"], old["historical_source"], old["historical_through"]) == (views, SOURCE, through):
                    continue
                changed.append((story_id, views, SOURCE, through))
            if not changed:
                return 0  # An identical reapply is safe even after tracking starts.
            cursor.execute("SELECT MIN(received_at) AS first_event FROM "
                           "public.hacksnap_popularity_events WHERE kind = 'view'")
            first_event = cursor.fetchone()["first_event"]
            cursor.execute("SELECT EXISTS (SELECT 1 FROM public.hacksnap_story_popularity "
                           "WHERE story_views > 0) AS has_views")
            has_views = cursor.fetchone()["has_views"]
            if first_event is not None or has_views:
                if through is None:
                    raise ValueError("First-party views exist; specify the actual GA --through cutoff before changing the baseline.")
                if first_event is None:
                    raise ValueError("Cannot verify the cutoff: live views exist without event receipts.")
                if through > first_event:
                    raise ValueError("GA --through overlaps first-party tracking; it must not be later than the first recorded view.")
                # Never move an established cutoff after tracking starts. Equal
                # cutoffs permit final GA processing corrections, without overlap.
                for story_id, _, _, _ in changed:
                    old = existing.get(story_id)
                    if old and old["historical_source"] and old["historical_through"] != through:
                        raise ValueError(f"Story {story_id} has an established baseline cutoff; it cannot change after tracking starts.")
            cursor.executemany(UPSERT, changed)
            return len(changed)


@click.command()
@click.argument("csv_path", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--apply", is_flag=True, help="Validate stored stories and atomically replace their historical baseline.")
@click.option("--through", default=None, help="Actual GA export end timestamp, with timezone; never guess it.")
def main(csv_path: Path, apply: bool, through: str | None) -> None:
    """Import GA standard page Views. Default preview makes no database connection."""
    try:
        snapshot = read_import(csv_path)
        cutoff = parse_through(through)
        for story_id, views in sorted(snapshot.totals.items(), key=lambda item: (-item[1], item[0])):
            aliases = [row.token for row in snapshot.rows if row.story_id == story_id]
            click.echo(f"{story_id}\t{views}" + (f" [merged {len(aliases)} source paths]" if len(aliases) > 1 else ""))
        click.echo(f"{len(snapshot.totals)} stories; {sum(snapshot.totals.values())} historical views; source={SOURCE}.")
        if not apply:
            click.echo("Dry run: no database access; stored IDs and slugs have not been checked. Use --apply to import.")
            return
        database_url = os.environ.get("HACKSNAP_IMPORT_DATABASE_URL")
        if not database_url:
            raise click.UsageError("Set HACKSNAP_IMPORT_DATABASE_URL to a dedicated server-only import connection.")
        changed = apply_import(database_url, snapshot, cutoff)
        click.echo(f"Applied {changed} baseline replacements; first-party counters preserved.")
    except (ValueError, OSError) as error:
        raise click.ClickException(str(error)) from error
    except psycopg.Error as error:
        # Driver failures can contain credentials or host connection parameters.
        raise click.ClickException("Database import failed; no changes committed. Check connectivity, migration, privileges, and server logs.") from error


if __name__ == "__main__":
    main()
