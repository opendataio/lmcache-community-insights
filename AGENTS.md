# Repository Guidance

- Keep the dashboard dependency-light. The nightly workflow intentionally uses a
  standard-library Python collector and static HTML/CSS/JS so GitHub Actions does
  not need package installation before data collection.
- Nightly runs use `FULL_HISTORY=false` and the committed
  `site/data/lmcache-metrics.json` as the historical baseline. This avoids
  storing a personal token secret for cross-repository stargazer/fork detail
  pagination, which GitHub Actions' integration token cannot access.
- Preserve metric definitions in `README.md` and the page UI whenever adding or
  renaming a metric. In particular, distinguish daily PR inflow/outflow from
  end-of-day open backlog.
- Stars and forks are reconstructed from currently existing timestamp-visible
  GitHub objects only. The repository fork summary can be higher than the
  timestamp-visible fork series; preserve that distinction unless a new durable
  data source is added.
- Contributors must use `contributors.contributorCount` from the public
  `https://github.com/{owner}/{repo}/_sidebar` endpoint, matching the repository
  homepage. Its avatar array is only a preview. The paginated REST contributors
  list, even with `anon=1`, is not equivalent (verified 2026-09-23: 355 homepage,
  319 REST, 322 REST with anonymous authors). Never substitute those counts.
- Store homepage counts as observed daily `github_contributors_total` snapshots
  and preserve them in both `FULL_HISTORY` modes. Do not backfill missing dates
  with author estimates or fabricate historical homepage totals. Keep the legacy
  `contributors_total` curve explicitly labeled as a commit-author estimate.
- The sidebar is an unversioned website endpoint. Validate its count and fail
  before writing/deploying on errors; do not publish an estimate as a fresh count.
  Send `GITHUB_TOKEN` only to `api.github.com`, never the website endpoint.
- Run `python3 -m unittest discover -s tests -v` and
  `node --check site/assets/app.js` for collector changes. The collector/tests
  work with Python 3.9+ and system timezone data without package installation.
  Validate the scheduled `FULL_HISTORY=false` path with its real Actions token;
  a local personal-token run does not prove integration-token compatibility.
- Before changing GitHub Actions or Pages deployment, verify workflow syntax with
  a local parser or a dry run where possible, and keep `workflow_dispatch`
  available for manual refreshes.
