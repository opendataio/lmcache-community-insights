# LMCache Community Insights

Nightly GitHub Pages dashboard for LMCache pull request and community activity.

The dashboard is generated from public GitHub data and tracks:

- daily opened pull requests
- daily closed pull requests
- daily merged pull requests
- daily net PR change (`opened - closed`)
- end-of-day open PR backlog
- current open PR total
- cumulative current stars by `starred_at`
- cumulative current forks by fork `created_at`
- the GitHub repository homepage contributor count, saved as daily snapshots
- a separate estimate of default-branch commit authors by first-seen date

## Metric Notes

PR metrics are reconstructed from every pull request returned by
`/repos/LMCache/LMCache/pulls?state=all`.

The end-of-day open PR backlog is:

```text
created_at < next_day_start AND (closed_at is null OR closed_at >= next_day_start)
```

Stars and forks are historical curves over currently existing, timestamp-visible
stars/forks. GitHub does not expose deleted historical stars/forks through the
public API, and the repository summary can include fork records that are not
available through the timestamped forks connection. Removed stars, deleted
forks, and timestamp-invisible forks cannot be reconstructed.

Contributors uses `contributors.contributorCount` from
[`https://github.com/LMCache/LMCache/_sidebar`](https://github.com/LMCache/LMCache/_sidebar),
the same source used by the GitHub repository homepage. The avatar list in that
response is only a preview; its length is not the total. The collector does not
send the API token to this public website endpoint.

The REST contributors list is not interchangeable with the homepage count. On
2026-09-23, the homepage returned 355, the paginated REST list returned 319, and
the list with `anon=1` returned 322. The previously published commit-author
estimate was also 322. Adding anonymous authors therefore does not resolve this
discrepancy. The dashboard follows the homepage count without inferring GitHub's
internal identity or attribution rules.

`summary.current_contributors` and daily `github_contributors_total` contain the
homepage count. Daily snapshots begin when this data source is first collected;
earlier dates and missed collection days have no value. Both full-history and
nightly refreshes preserve observed snapshots, and another run on the same day
replaces that day's value. As a nightly snapshot, the dashboard can lag changes
on the live GitHub page until the next refresh.

The dashed **Commit authors (estimate)** curve remains separate, stored in
`contributors_total` and `summary.estimated_contributors`. It is reconstructed
from unique default-branch commit authors and cannot supply historical homepage
counts. The change in data source is not presented as contributor growth.

The sidebar is a GitHub website endpoint rather than a versioned REST API. If it
fails or its count schema changes, collection fails before writing the data file;
the workflow leaves the previous published snapshot intact. It does not silently
substitute the REST list or the author estimate.

To check the current count (requires `curl` and Python 3):

```bash
curl -fsSL -H 'Accept: application/json' https://github.com/LMCache/LMCache/_sidebar |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["contributors"]["contributorCount"])'
```

## Local Generation

Use Python 3.9+ with timezone data and an authenticated GitHub CLI. The collector
and its tests use only the Python standard library.

```bash
python3 -m unittest discover -s tests -v
GITHUB_TOKEN="$(gh auth token)" python3 scripts/fetch_lmcache_metrics.py
python3 -m http.server 8000 --directory site
```

Then open `http://localhost:8000`.

The scheduled workflow runs with `FULL_HISTORY=false`. In that mode the script
uses the committed JSON file as the historical baseline, refreshes PR metrics
from pull request timestamps, updates current stars/forks from repository
summary counts, and commits the new snapshot back to the repository. This avoids
requiring a personal token secret for nightly runs. Both modes also refresh the
homepage contributor count and keep the previously observed contributor snapshots.

## Deployment

The `Update LMCache metrics` workflow runs nightly and can also be triggered
manually. It updates `site/data/lmcache-metrics.json`, commits the refreshed
snapshot, and publishes the static site through GitHub Pages.
