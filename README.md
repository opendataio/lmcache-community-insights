# LMCache Community Insights

Nightly GitHub Pages dashboard for LMCache pull request and community activity.

The dashboard is generated from the public GitHub API and tracks:

- daily opened pull requests
- daily closed pull requests
- daily merged pull requests
- daily net PR change (`opened - closed`)
- end-of-day open PR backlog
- current open PR total
- cumulative current stars by `starred_at`
- cumulative current forks by fork `created_at`
- cumulative default-branch contributors by first-seen commit author date

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

The contributor curve is an estimate based on unique default-branch commit
authors and their first commit date. It is useful for trend direction, but it is
not the same as GitHub's complete contributor graph across every branch and
identity merge.

## Local Generation

```bash
GITHUB_TOKEN="$(gh auth token)" python3 scripts/fetch_lmcache_metrics.py
python3 -m http.server 8000 --directory site
```

Then open `http://localhost:8000`.

## Deployment

The `Update LMCache metrics` workflow runs nightly and can also be triggered
manually. It regenerates `site/data/lmcache-metrics.json` and publishes the
static site through GitHub Pages.
