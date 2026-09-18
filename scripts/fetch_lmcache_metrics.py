#!/usr/bin/env python3
"""Fetch LMCache GitHub metrics and write the static dashboard data file."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


API_ROOT = "https://api.github.com"
TARGET_REPOSITORY = os.environ.get("TARGET_REPOSITORY", "LMCache/LMCache")
METRIC_TIMEZONE = os.environ.get("METRIC_TIMEZONE", "Asia/Shanghai")
OUTPUT_PATH = Path(os.environ.get("OUTPUT_PATH", "site/data/lmcache-metrics.json"))
TOKEN = os.environ.get("GITHUB_TOKEN")
OWNER, REPO = TARGET_REPOSITORY.split("/", 1)


@dataclass(frozen=True)
class PullRequest:
    created_at: datetime
    closed_at: datetime | None
    merged_at: datetime | None


def parse_github_datetime(value: str | None, tz: ZoneInfo) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(tz)


def request_json(
    path_or_url: str,
    *,
    accept: str = "application/vnd.github+json",
    method: str = "GET",
    body: bytes | None = None,
) -> tuple[Any, dict[str, str]]:
    if path_or_url.startswith("http"):
        url = path_or_url
    else:
        url = f"{API_ROOT}{path_or_url}"

    headers = {
        "Accept": accept,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "opendataio-lmcache-community-insights",
    }
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"

    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read().decode("utf-8")
                return json.loads(body), {key.lower(): value for key, value in response.headers.items()}
        except urllib.error.HTTPError as exc:
            retry_after = exc.headers.get("Retry-After")
            rate_remaining = exc.headers.get("X-RateLimit-Remaining")
            if exc.code in {403, 429} and (retry_after or rate_remaining == "0"):
                sleep_for = int(retry_after or "60")
                print(f"Rate limited while fetching {url}; sleeping {sleep_for}s", file=sys.stderr)
                time.sleep(sleep_for)
                continue
            if exc.code >= 500 and attempt < 3:
                time.sleep(2**attempt)
                continue
            raise
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(2**attempt)
                continue
            raise

    raise RuntimeError(f"Failed to fetch {url}")


def graphql(query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    payload, _ = request_json(
        f"{API_ROOT}/graphql",
        accept="application/vnd.github+json",
        method="POST",
        body=body,
    )
    if payload.get("errors"):
        raise RuntimeError(json.dumps(payload["errors"], indent=2))
    return payload["data"]


def parse_next_link(link_header: str | None) -> str | None:
    if not link_header:
        return None
    for part in link_header.split(","):
        section = part.strip()
        if 'rel="next"' not in section:
            continue
        start = section.find("<")
        end = section.find(">")
        if start >= 0 and end > start:
            return section[start + 1 : end]
    return None


def paginated_rest(path: str, *, accept: str = "application/vnd.github+json", name: str) -> list[Any]:
    items: list[Any] = []
    next_url: str | None = path
    while next_url:
        payload, headers = request_json(next_url, accept=accept)
        if not isinstance(payload, list):
            raise TypeError(f"Expected list response for {next_url}, got {type(payload)!r}")
        items.extend(payload)
        log_progress(name, len(items))
        next_url = parse_next_link(headers.get("link"))
    return items


def log_progress(name: str, count: int) -> None:
    print(f"Fetched {count} {name}...", file=sys.stderr, flush=True)


def should_try_rest_fallback(error: Exception) -> bool:
    return "Resource not accessible by integration" in str(error) or '"type": "FORBIDDEN"' in str(error)


def get_repository_summary() -> dict[str, int]:
    data = graphql(
        """
        query RepositorySummary($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            stargazerCount
            forkCount
            openPullRequests: pullRequests(states: OPEN) {
              totalCount
            }
          }
        }
        """,
        {"owner": OWNER, "name": REPO},
    )
    repository = data["repository"]
    return {
        "current_open_prs": int(repository["openPullRequests"]["totalCount"]),
        "current_stars": int(repository["stargazerCount"]),
        "current_forks": int(repository["forkCount"]),
    }


def get_pull_requests(tz: ZoneInfo) -> list[PullRequest]:
    query = """
    query PullRequests($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequests(
          first: 100
          after: $cursor
          orderBy: {field: CREATED_AT, direction: ASC}
        ) {
          nodes {
            createdAt
            closedAt
            mergedAt
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
    """
    prs: list[PullRequest] = []
    cursor: str | None = None
    while True:
        data = graphql(query, {"owner": OWNER, "name": REPO, "cursor": cursor})
        connection = data["repository"]["pullRequests"]
        for item in connection["nodes"]:
            created_at = parse_github_datetime(item["createdAt"], tz)
            if created_at is None:
                continue
            prs.append(
                PullRequest(
                    created_at=created_at,
                    closed_at=parse_github_datetime(item.get("closedAt"), tz),
                    merged_at=parse_github_datetime(item.get("mergedAt"), tz),
                )
            )
        log_progress("pull requests", len(prs))
        if not connection["pageInfo"]["hasNextPage"]:
            return prs
        cursor = connection["pageInfo"]["endCursor"]


def get_star_dates(tz: ZoneInfo) -> list[date]:
    query = """
    query Stargazers($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        stargazers(
          first: 100
          after: $cursor
          orderBy: {field: STARRED_AT, direction: ASC}
        ) {
          edges {
            starredAt
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
    """
    dates: list[date] = []
    cursor: str | None = None
    try:
        while True:
            data = graphql(query, {"owner": OWNER, "name": REPO, "cursor": cursor})
            connection = data["repository"]["stargazers"]
            dates.extend(
                parsed.date()
                for edge in connection["edges"]
                if (parsed := parse_github_datetime(edge.get("starredAt"), tz)) is not None
            )
            log_progress("stargazers", len(dates))
            if not connection["pageInfo"]["hasNextPage"]:
                return dates
            cursor = connection["pageInfo"]["endCursor"]
    except RuntimeError as error:
        if not should_try_rest_fallback(error):
            raise
        print("GraphQL stargazers unavailable; falling back to REST.", file=sys.stderr, flush=True)

    stars = paginated_rest(
        f"/repos/{TARGET_REPOSITORY}/stargazers?per_page=100",
        accept="application/vnd.github.star+json",
        name="stargazers",
    )
    return [
        parsed.date()
        for item in stars
        if (parsed := parse_github_datetime(item.get("starred_at"), tz)) is not None
    ]


def get_fork_dates(tz: ZoneInfo) -> list[date]:
    query = """
    query Forks($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        forks(
          first: 100
          after: $cursor
          orderBy: {field: CREATED_AT, direction: ASC}
        ) {
          nodes {
            createdAt
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
    """
    dates: list[date] = []
    cursor: str | None = None
    try:
        while True:
            data = graphql(query, {"owner": OWNER, "name": REPO, "cursor": cursor})
            connection = data["repository"]["forks"]
            dates.extend(
                parsed.date()
                for item in connection["nodes"]
                if (parsed := parse_github_datetime(item.get("createdAt"), tz)) is not None
            )
            log_progress("forks", len(dates))
            if not connection["pageInfo"]["hasNextPage"]:
                return dates
            cursor = connection["pageInfo"]["endCursor"]
    except RuntimeError as error:
        if not should_try_rest_fallback(error):
            raise
        print("GraphQL forks unavailable; falling back to REST.", file=sys.stderr, flush=True)

    forks = paginated_rest(f"/repos/{TARGET_REPOSITORY}/forks?per_page=100&sort=newest", name="forks")
    return [
        parsed.date()
        for item in forks
        if (parsed := parse_github_datetime(item.get("created_at"), tz)) is not None
    ]


def rest_commit_author_key(commit: dict[str, Any]) -> str | None:
    author = commit.get("author") or {}
    if author.get("login"):
        return f"login:{author['login']}"

    raw_author = commit.get("commit", {}).get("author", {})
    email = (raw_author.get("email") or "").strip().lower()
    name = (raw_author.get("name") or "").strip().lower()
    if email:
        return f"email:{email}"
    if name:
        return f"name:{name}"
    return None


def get_contributor_first_dates(tz: ZoneInfo) -> dict[str, date]:
    query = """
    query CommitHistory($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 100, after: $cursor) {
                nodes {
                  committedDate
                  author {
                    name
                    email
                    user {
                      login
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      }
    }
    """
    first_seen: dict[str, date] = {}
    cursor: str | None = None
    fetched_commits = 0
    try:
        while True:
            data = graphql(query, {"owner": OWNER, "name": REPO, "cursor": cursor})
            target = data["repository"]["defaultBranchRef"]["target"]
            history = target["history"]
            for commit in history["nodes"]:
                author = commit.get("author") or {}
                user = author.get("user") or {}
                key = None
                if user.get("login"):
                    key = f"login:{user['login']}"
                elif author.get("email"):
                    key = f"email:{author['email'].strip().lower()}"
                elif author.get("name"):
                    key = f"name:{author['name'].strip().lower()}"

                commit_dt = parse_github_datetime(commit.get("committedDate"), tz)
                if key is None or commit_dt is None:
                    continue
                commit_day = commit_dt.date()
                current = first_seen.get(key)
                if current is None or commit_day < current:
                    first_seen[key] = commit_day

            fetched_commits += len(history["nodes"])
            log_progress("commits", fetched_commits)
            if not history["pageInfo"]["hasNextPage"]:
                return first_seen
            cursor = history["pageInfo"]["endCursor"]
    except RuntimeError as error:
        if not should_try_rest_fallback(error):
            raise
        print("GraphQL commit history unavailable; falling back to REST.", file=sys.stderr, flush=True)

    commits = paginated_rest(f"/repos/{TARGET_REPOSITORY}/commits?per_page=100", name="commits")
    for commit in commits:
        key = rest_commit_author_key(commit)
        raw_date = commit.get("commit", {}).get("author", {}).get("date")
        commit_dt = parse_github_datetime(raw_date, tz)
        if key is None or commit_dt is None:
            continue
        commit_day = commit_dt.date()
        current = first_seen.get(key)
        if current is None or commit_day < current:
            first_seen[key] = commit_day
    return first_seen


def daterange(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def cumulative_value(counter: Counter[date], current: date, running: int) -> int:
    return running + counter[current]


def build_daily_metrics(
    prs: list[PullRequest],
    star_dates: list[date],
    fork_dates: list[date],
    contributor_first_dates: dict[str, date],
    tz: ZoneInfo,
) -> list[dict[str, Any]]:
    opened = Counter(pr.created_at.date() for pr in prs)
    closed = Counter(pr.closed_at.date() for pr in prs if pr.closed_at is not None)
    merged = Counter(pr.merged_at.date() for pr in prs if pr.merged_at is not None)
    stars = Counter(star_dates)
    forks = Counter(fork_dates)
    contributors = Counter(contributor_first_dates.values())

    all_dates = set(opened) | set(closed) | set(merged) | set(stars) | set(forks) | set(contributors)
    if not all_dates:
        return []

    start = min(all_dates)
    end = datetime.now(tz).date()

    stars_total = 0
    forks_total = 0
    contributors_total = 0
    daily: list[dict[str, Any]] = []

    for day in daterange(start, end):
        stars_total = cumulative_value(stars, day, stars_total)
        forks_total = cumulative_value(forks, day, forks_total)
        contributors_total = cumulative_value(contributors, day, contributors_total)
        next_day_start = datetime.combine(day + timedelta(days=1), datetime_time.min, tz)
        open_eod = sum(
            pr.created_at < next_day_start
            and (pr.closed_at is None or pr.closed_at >= next_day_start)
            for pr in prs
        )

        daily.append(
            {
                "date": day.isoformat(),
                "prs_opened": opened[day],
                "prs_closed": closed[day],
                "prs_merged": merged[day],
                "pr_net": opened[day] - closed[day],
                "prs_open_eod": open_eod,
                "stars_total": stars_total,
                "forks_total": forks_total,
                "contributors_total": contributors_total,
            }
        )

    return daily


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    tmp_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def main() -> None:
    tz = ZoneInfo(METRIC_TIMEZONE)
    repo_summary = get_repository_summary()
    prs = get_pull_requests(tz)
    star_dates = get_star_dates(tz)
    fork_dates = get_fork_dates(tz)
    contributor_first_dates = get_contributor_first_dates(tz)

    daily = build_daily_metrics(prs, star_dates, fork_dates, contributor_first_dates, tz)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "repository": TARGET_REPOSITORY,
        "timezone": METRIC_TIMEZONE,
        "summary": {
            "current_open_prs": repo_summary["current_open_prs"],
            "current_stars": repo_summary["current_stars"],
            "current_forks": repo_summary["current_forks"],
            "visible_forks_tracked": len(fork_dates),
            "untracked_forks": max(0, repo_summary["current_forks"] - len(fork_dates)),
            "estimated_contributors": len(contributor_first_dates),
        },
        "daily": daily,
    }
    write_json(OUTPUT_PATH, payload)

    print(
        "Generated "
        f"{OUTPUT_PATH} with {len(daily)} days, {len(prs)} PRs, "
        f"{len(star_dates)} stars, {len(fork_dates)} forks, "
        f"{len(contributor_first_dates)} estimated contributors."
    )


if __name__ == "__main__":
    main()
