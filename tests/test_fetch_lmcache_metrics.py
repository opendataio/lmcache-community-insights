"""Regression checks for the homepage contributor count and its daily snapshots."""

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from scripts import fetch_lmcache_metrics as metrics


class ContributorCountTests(unittest.TestCase):
    def test_uses_homepage_count_not_avatar_preview_length(self):
        payload = {"contributors": {"contributorCount": 355, "contributors": [{"login": "a"}]}}
        with patch.object(metrics, "request_json", return_value=(payload, {})) as request:
            self.assertEqual(metrics.get_current_contributor_count(), 355)
        request.assert_called_once_with(metrics.CONTRIBUTOR_COUNT_URL, accept="application/json")

    def test_zero_is_a_valid_count(self):
        with patch.object(metrics, "request_json", return_value=(
            {"contributors": {"contributorCount": 0}}, {}
        )):
            self.assertEqual(metrics.get_current_contributor_count(), 0)

    def test_changed_or_invalid_schema_fails_instead_of_using_an_estimate(self):
        payloads = [None, [], {}, {"contributors": None}, {"contributors": []}]
        payloads += [{"contributors": {"contributorCount": value}}
                     for value in [None, "355", 355.0, -1, True]]
        for payload in payloads:
            with self.subTest(payload=payload), patch.object(
                metrics, "request_json", return_value=(payload, {})
            ), self.assertRaises(ValueError):
                metrics.get_current_contributor_count()

    def test_api_token_is_not_sent_to_website(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b"{}"
        response.headers = {}
        with patch.object(metrics, "TOKEN", "test-token"), patch.object(
            metrics.urllib.request, "urlopen", return_value=response
        ) as urlopen:
            metrics.request_json(metrics.CONTRIBUTOR_COUNT_URL, accept="application/json")
            self.assertIsNone(urlopen.call_args.args[0].get_header("Authorization"))
            metrics.request_json("/repos/LMCache/LMCache")
            self.assertEqual(
                urlopen.call_args.args[0].get_header("Authorization"), "Bearer test-token"
            )


class ContributorSnapshotTests(unittest.TestCase):
    def test_migration_does_not_turn_old_estimates_into_homepage_counts(self):
        old = {"daily": [{"date": "2026-09-22", "contributors_total": 322}]}
        daily = [
            {"date": "2026-09-22", "contributors_total": 322},
            {"date": "2026-09-23", "contributors_total": 322},
        ]
        metrics.apply_contributor_snapshots(daily, old, 355)
        self.assertNotIn("github_contributors_total", daily[0])
        self.assertEqual(daily[1]["github_contributors_total"], 355)
        self.assertEqual([row["contributors_total"] for row in daily], [322, 322])

    def test_preserves_zero_and_gaps_and_replaces_same_day_with_lower_count(self):
        old = {"daily": [
            {"date": "2026-09-20", "github_contributors_total": 0},
            {"date": "2026-09-21", "github_contributors_total": 350},
            {"date": "2026-09-23", "github_contributors_total": 356},
        ]}
        daily = [{"date": f"2026-09-{day}"} for day in range(20, 24)]
        metrics.apply_contributor_snapshots(daily, old, 355)
        self.assertEqual([row.get("github_contributors_total") for row in daily],
                         [0, 350, None, 355])

    def test_main_preserves_snapshots_in_both_refresh_modes(self):
        tz = ZoneInfo(metrics.METRIC_TIMEZONE)
        today = datetime.now(tz).date()
        first_day = today - timedelta(days=2)
        first_date = first_day.isoformat()
        existing = {"summary": {"visible_forks_tracked": 1}, "daily": [
            {"date": first_date, "contributors_total": 1, "github_contributors_total": 354}
        ]}
        prs = [metrics.PullRequest(datetime.combine(first_day, datetime.min.time(), tz), None, None)]
        summary = {"current_stars": 10, "current_forks": 2, "current_open_prs": 1}
        for full_history in (False, True):
            with self.subTest(full_history=full_history), tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "metrics.json"
                output.write_text(json.dumps(existing))
                with patch.multiple(metrics, FULL_HISTORY=full_history, OUTPUT_PATH=output), \
                     patch.object(metrics, "get_repository_summary", return_value=summary), \
                     patch.object(metrics, "get_pull_requests", return_value=prs), \
                     patch.object(metrics, "get_current_contributor_count", return_value=355), \
                     patch.object(metrics, "get_star_dates", return_value=[first_day]), \
                     patch.object(metrics, "get_fork_dates", return_value=[first_day]), \
                     patch.object(metrics, "get_contributor_first_dates", return_value={"a": first_day}):
                    metrics.main()
                result = json.loads(output.read_text())
                self.assertEqual(result["summary"]["current_contributors"], 355)
                self.assertEqual(result["summary"]["estimated_contributors"], 1)
                self.assertEqual(result["contributor_count_source"], metrics.CONTRIBUTOR_COUNT_URL)
                self.assertEqual([row.get("github_contributors_total") for row in result["daily"]],
                                 [354, None, 355])

    def test_unavailable_homepage_count_does_not_overwrite_published_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "metrics.json"
            original = '{"daily": [], "summary": {"current_contributors": 354}}\n'
            output.write_text(original)
            with patch.object(metrics, "OUTPUT_PATH", output), \
                 patch.object(metrics, "get_repository_summary", return_value={}), \
                 patch.object(metrics, "get_pull_requests", return_value=[]), \
                 patch.object(metrics, "get_current_contributor_count", side_effect=ValueError("schema")), \
                 self.assertRaises(ValueError):
                metrics.main()
            self.assertEqual(output.read_text(), original)


class DraftExclusionTests(unittest.TestCase):
    """Draft pull requests are excluded from every PR metric and raw event."""

    def test_build_daily_metrics_excludes_drafts(self):
        tz = ZoneInfo(metrics.METRIC_TIMEZONE)
        day = datetime(2026, 10, 1, 10, 0, 0, tzinfo=tz)
        day_label = day.date().isoformat()
        prs = [
            metrics.PullRequest(day, None, None),
            metrics.PullRequest(day, None, None, is_draft=True),
            metrics.PullRequest(day, day + timedelta(hours=2), None, is_draft=True),
        ]
        daily = metrics.build_daily_metrics(prs, [], [], {}, tz)
        row = next(r for r in daily if r["date"] == day_label)
        self.assertEqual(row["prs_opened"], 1)
        self.assertEqual(row["prs_closed"], 0)
        self.assertEqual(row["pr_net"], 1)
        self.assertEqual(row["prs_open_eod"], 1)

    def test_build_daily_metrics_from_snapshots_excludes_drafts(self):
        tz = ZoneInfo(metrics.METRIC_TIMEZONE)
        today = datetime.now(tz).date()
        day = datetime.combine(today, datetime.min.time(), tz)
        day_label = today.isoformat()
        prs = [
            metrics.PullRequest(day, None, None),
            metrics.PullRequest(day, None, None, is_draft=True),
        ]
        daily = metrics.build_daily_metrics_from_snapshots(
            prs, None, {"current_stars": 1, "current_forks": 0}, {}, tz
        )
        row = next(r for r in daily if r["date"] == day_label)
        self.assertEqual(row["prs_opened"], 1)
        self.assertEqual(row["prs_open_eod"], 1)

    def test_main_writes_non_draft_events_and_open_count(self):
        tz = ZoneInfo(metrics.METRIC_TIMEZONE)
        today = datetime.now(tz).date()
        base = datetime.combine(today, datetime.min.time(), tz)
        draft_created = base + timedelta(hours=3)
        prs = [
            metrics.PullRequest(base, None, None),
            metrics.PullRequest(base, base, None),
            metrics.PullRequest(draft_created, None, None, is_draft=True),
        ]
        summary = {"current_stars": 5, "current_forks": 2}
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "metrics.json"
            with patch.multiple(metrics, FULL_HISTORY=False, OUTPUT_PATH=output), \
                 patch.object(metrics, "get_repository_summary", return_value=summary), \
                 patch.object(metrics, "get_pull_requests", return_value=prs), \
                 patch.object(metrics, "get_current_contributor_count", return_value=10), \
                 patch.object(metrics, "get_contributor_first_dates", return_value={}):
                metrics.main()
            result = json.loads(output.read_text())
        self.assertTrue(result["excludes_drafts"])
        self.assertEqual(result["summary"]["current_open_prs"], 1)
        events = result["events"]["prs"]
        self.assertEqual(len(events), 2)
        event_timestamps = [event["created_at"] for event in events]
        self.assertNotIn(draft_created.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                         event_timestamps)
        for event in events:
            self.assertEqual(event["created_at"][-1], "Z")
            self.assertIn("created_at", event)


if __name__ == "__main__":
    unittest.main()
