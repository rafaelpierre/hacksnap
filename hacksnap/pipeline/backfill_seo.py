"""Preview or execute one bounded batch using stored summaries only."""

import argparse
import json

from .config import Settings, database_url_from_env
from .seo import SeoAgent, refresh_seo
from .seo_repository import SeoRepository


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--after-id", type=int, default=0)
    parser.add_argument("--execute", action="store_true", help="Generate and persist metadata")
    args = parser.parse_args()
    if not 1 <= args.limit <= 50 or args.after_id < 0:
        parser.error("limit must be 1-50 and after-id must be nonnegative")
    repository = SeoRepository(database_url_from_env())
    if not args.execute:
        # Dry run is DB-read-only and needs no inference credentials.
        rows = repository.seo_candidates(limit=args.limit, after_id=args.after_id)
        print(json.dumps({"candidate_ids": [row["story_id"] for row in rows],
                          "last_id": rows[-1]["story_id"] if rows else None}))
        return
    result = refresh_seo(repository, SeoAgent(Settings.from_env()),
                         limit=args.limit, after_id=args.after_id)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
