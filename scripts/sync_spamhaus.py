"""Replace a dedicated Cloudflare IP list with validated Spamhaus DROP feeds."""

import argparse
import ipaddress
import json
import os
import re
import time
from urllib.request import Request, urlopen


def parse_feed(text, version, now=None):
    rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    if not rows or rows[-1].get("type") != "metadata":
        raise ValueError("Missing final feed metadata")
    metadata = rows.pop()
    age = (time.time() if now is None else now) - metadata["timestamp"]
    if not -3600 <= age <= 7 * 86400:
        raise ValueError("Feed timestamp is stale or in the future")
    if not rows or metadata["records"] != len(rows):
        raise ValueError("Empty or truncated feed")
    if not metadata.get("copyright"):
        raise ValueError("Missing Spamhaus attribution")
    items = {}
    for row in rows:
        network = ipaddress.ip_network(row["cidr"], strict=True)
        if network.version != version or network.prefixlen < {4: 8, 6: 12}[version]:
            raise ValueError("Wrong address family or unsupported broad range")
        if not network.is_global:
            raise ValueError("Non-public network in feed")
        items[str(network)] = {
            "ip": str(network),
            "comment": f"Spamhaus DROP {row['sblid']}; {metadata['timestamp']}; {metadata['copyright']}",
        }
    return list(items.values())


def request(url, token=None, method="GET", body=None):
    headers = {"User-Agent": "Hacksnap-Spamhaus-Sync/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    # Do not retry mutations: a timed-out request may already be processing.
    with urlopen(Request(url, data=data, headers=headers, method=method), timeout=30) as response:
        text = response.read(10_000_001)
    if len(text) > 10_000_000:
        raise ValueError("Response exceeds size limit")
    if not token:
        return text.decode()
    result = json.loads(text)
    if result.get("success") is not True:
        raise ValueError("Cloudflare reported an API failure")
    return result


def sync(items, api, list_id, apply=False):
    if not 2 <= len(items) <= 10_000:
        raise ValueError("Feed size outside Cloudflare Free limits")
    target = f"/lists/{list_id}"
    info = api(target)["result"]
    if info["name"] != "spamhaus_drop" or info["kind"] != "ip":
        raise ValueError("Target must be the dedicated spamhaus_drop IP list")
    current = set()
    cursor = None
    while True:
        suffix = f"&cursor={cursor}" if cursor else ""
        page = api(f"{target}/items?per_page=1000{suffix}")
        current.update(str(ipaddress.ip_network(item["ip"])) for item in page["result"])
        next_cursor = page.get("result_info", {}).get("cursors", {}).get("after")
        if not next_cursor:
            break
        if next_cursor == cursor:
            raise ValueError("Cloudflare pagination did not advance")
        cursor = next_cursor
    desired = {item["ip"] for item in items}
    for version in (4, 6):
        old = {ip for ip in current if ipaddress.ip_network(ip).version == version}
        new = {ip for ip in desired if ipaddress.ip_network(ip).version == version}
        if not new or (old and len(old - new) > len(old) * 0.25):
            raise ValueError("Missing address family or more than 25% of existing ranges removed; review feeds")
    print(f"Current: {len(current)}; desired: {len(desired)}; add: {len(desired-current)}; remove: {len(current-desired)}")
    if current == desired:
        print("Already up to date")
        return
    if not apply:
        print("Dry run: no Cloudflare changes")
        return
    operation = api(f"{target}/items", "PUT", items)["result"]["operation_id"]
    for _ in range(60):
        result = api(f"/bulk_operations/{operation}")["result"]
        if result["status"] == "completed":
            print("Cloudflare replacement completed")
            return
        if result["status"] not in {"pending", "running"}:
            raise ValueError("Cloudflare replacement failed")
        time.sleep(5)
    raise TimeoutError("Cloudflare operation still pending; inspect it before retrying")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Replace list contents (default: dry run)")
    args = parser.parse_args()
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    list_id = os.environ["CLOUDFLARE_SPAMHAUS_LIST_ID"]
    token = os.environ["CLOUDFLARE_LISTS_API_TOKEN"]
    if not token or not all(re.fullmatch(r"[a-fA-F0-9]{32}", value) for value in (account, list_id)):
        raise ValueError("Missing token or invalid account/list ID")
    items = []
    for version in (4, 6):
        feed = request(f"https://www.spamhaus.org/drop/drop_v{version}.json")
        items.extend(parse_feed(feed, version))
    base = f"https://api.cloudflare.com/client/v4/accounts/{account}/rules"
    sync(items, lambda path, method="GET", body=None: request(base + path, token, method, body), list_id, args.apply)


if __name__ == "__main__":
    main()
