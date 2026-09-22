# Weekly Spamhaus DROP synchronization

The `Sync Spamhaus DROP to Cloudflare` GitHub Actions workflow refreshes IPv4 and
IPv6 ranges every Monday at approximately 06:23 UTC. GitHub schedules can be delayed;
the workflow must be on the default branch. It does not enable Bot Fight Mode.

## One-time setup

1. Create an account-level Cloudflare **IP list** named `spamhaus`. It must
   be dedicated to this workflow: every apply replaces its entire contents.
   Free accounts normally have one custom list and 10,000 entries available.
   Do not repurpose a list containing manual blocks or exceptions.
2. Create a custom API token scoped to the intended Cloudflare account with
   write access to rule lists. Under **Account**, look for **Account Rule Lists**
   with **Write** (or **Edit**, depending on the token editor). Cloudflare also
   documents the legacy name **Account Filter Lists: Edit**; its permission
   reference lists both names for access to the same resource. Search for
   `Lists` rather than the full legacy label.
   This is a separate token from the site's existing cache-purge token.
3. In GitHub repository Settings → Secrets and variables → Actions, configure:

   | Type | Name | Value |
   | --- | --- | --- |
   | Secret | `CLOUDFLARE_LISTS_API_TOKEN` | The dedicated token |
   | Secret | `CLOUDFLARE_ACCOUNT_ID` | Account ID, not zone ID |
   | Secret | `CLOUDFLARE_LIST_ID` | Dedicated list's ID |
   | Secret | `SPAMHAUS_SYNC_ENABLED` | `true` to enable scheduled updates |

4. Run the workflow manually with **dry_run checked**. Review additions and
   removals. Run again with it unchecked to populate the list.
5. Create a Cloudflare custom rule with `ip.src in $spamhaus`, action
   **Block**, before geographic challenges. The workflow manages list contents,
   not firewall rules. Keep GitHub Actions failure notifications enabled.

## Behavior and safeguards

- Downloads both official Spamhaus JSON-lines feeds over HTTPS. Validates final
  metadata, record counts, address family, public CIDRs and Cloudflare prefix
  limits before writing anything. Rejects timestamps older than seven days or
  more than one hour in the future. Seven days accommodates feeds whose
  publication timestamp does not advance daily; each weekly run fetches
  the current feeds.
- Retains Spamhaus copyright, publication timestamp and SBL ID in item comments.
- Refuses empty feeds, more than 10,000 combined entries, the wrong list name or
  type, or removal of more than 25% of existing ranges in either address family.
  A rejected feed leaves the existing list untouched; investigate the source
  and review the guard before making an exceptional change.
- Reads all existing pages, skips unchanged IP sets, and uses Cloudflare's
  replacement operation so delisted ranges disappear. No delete-then-add gap is
  deliberately introduced. Does not promise an atomic Cloudflare transaction.
- Waits for the asynchronous operation to complete. API errors, failed
  operations, and timeouts fail the workflow. A timeout after submission can
  mean the update is still running: inspect Cloudflare before retrying.
- Serializes workflow runs and never automatically retries a write. Other
  account-level list writers may cause a concurrent-operation rejection.
- Pull requests and pushes run offline tests only. Manual runs default to dry
  run; scheduled writes require `SPAMHAUS_SYNC_ENABLED=true`.

To stop updates, set `SPAMHAUS_SYNC_ENABLED=false`. Existing blocks remain;
disable the Cloudflare rule separately if you need to stop enforcement.

Run tests locally: `python3 -m unittest discover -s scripts/tests -v`.
The script uses Python's standard library, with no package installation.

## Sources

- [Spamhaus DROP feeds and usage terms](https://www.spamhaus.org/blocklists/do-not-route-or-peer/)
- [Cloudflare list limits](https://developers.cloudflare.com/waf/tools/lists/#availability)
- [Cloudflare replacement API](https://developers.cloudflare.com/api/resources/rules/subresources/lists/subresources/items/methods/update/)

DROP identifies high-confidence malicious networks, not every scraper or bot.
