import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sync_spamhaus import parse_feed, sync


class FeedTests(unittest.TestCase):
    def feed(self, cidr="8.8.8.0/24", **overrides):
        meta = dict(type="metadata", timestamp=1000000, records=1, copyright="Spamhaus")
        meta.update(overrides)
        return json.dumps(dict(cidr=cidr, sblid="SBL123")) + "\n" + json.dumps(meta)

    def test_ipv4_and_ipv6(self):
        for version, cidr in [(4, "8.8.8.0/24"), (6, "2606:4700::/32")]:
            self.assertEqual(parse_feed(self.feed(cidr), version, 1000000)[0]["ip"], cidr)

    def test_reject_bad_feeds(self):
        for feed in ["", "<html>Error</html>", self.feed(records=2),
                     self.feed(timestamp=1), self.feed("0.0.0.0/0"),
                     self.feed("192.168.0.0/24"), self.feed("8.8.8.1/24"),
                     self.feed("2606:4700::/32")]:
            with self.subTest(feed=feed), self.assertRaises((ValueError, KeyError)):
                parse_feed(feed, 4, 1000000)


class SyncTests(unittest.TestCase):
    items = [{"ip": "8.8.8.0/24"}, {"ip": "2606:4700::/32"}]

    def api(self, current=None):
        return Mock(side_effect=[
            {"result": {"name": "spamhaus", "kind": "ip"}},
            {"result": current or []},
            {"result": {"operation_id": "operation"}},
            {"result": {"status": "completed"}},
        ])

    def test_dry_run_never_writes(self):
        api = self.api()
        sync(self.items, api, "list")
        self.assertEqual(api.call_count, 2)

    def test_apply_waits_for_completion(self):
        api = self.api()
        sync(self.items, api, "list", apply=True)
        self.assertEqual(api.call_args_list[2].args, ("/lists/list/items", "PUT", self.items))
        self.assertEqual(api.call_count, 4)

    def test_empty_list_request_respects_cloudflare_page_limit(self):
        responses = self.api()

        def checked_api(path, *args):
            if "/items?" in path:
                query = parse_qs(urlsplit(path).query)
                self.assertLessEqual(int(query["per_page"][0]), 500)
            return responses(path, *args)

        sync(self.items, checked_api, "list", apply=True)
        self.assertEqual(responses.call_args_list[2].args[1], "PUT")

    def test_noop(self):
        api = self.api(self.items)
        sync(self.items, api, "list", apply=True)
        self.assertEqual(api.call_count, 2)

    def test_large_removal_preserves_list(self):
        api = self.api([{"ip": "1.1.1.0/24"}, self.items[1]])
        with self.assertRaises(ValueError):
            sync(self.items, api, "list", apply=True)
        self.assertEqual(api.call_count, 2)

    def test_wrong_list_rejected(self):
        api = Mock(return_value={"result": {"name": "personal_list", "kind": "ip"}})
        with self.assertRaises(ValueError):
            sync(self.items, api, "list", apply=True)
        self.assertEqual(api.call_count, 1)

    def test_failed_operation_fails_run(self):
        api = self.api()
        api.side_effect = [
            {"result": {"name": "spamhaus", "kind": "ip"}},
            {"result": []}, {"result": {"operation_id": "operation"}},
            {"result": {"status": "failed"}},
        ]
        with self.assertRaises(ValueError):
            sync(self.items, api, "list", apply=True)

    def test_pagination(self):
        api = Mock(side_effect=[
            {"result": {"name": "spamhaus", "kind": "ip"}},
            {"result": self.items[:1], "result_info": {"cursors": {"after": "next+/=&"}}},
            {"result": self.items[1:]},
        ])
        sync(self.items, api, "list", apply=True)
        self.assertEqual(api.call_count, 3)
        query = parse_qs(urlsplit(api.call_args.args[0]).query)
        self.assertEqual(query["cursor"], ["next+/=&"])
        self.assertEqual(query["per_page"], ["500"])


if __name__ == "__main__":
    unittest.main()
