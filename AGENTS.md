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
- The contributor curve is based on default-branch commit authors first seen in
  commit history. Treat it as an estimate, not a complete GitHub contributor
  graph.
- Before changing GitHub Actions or Pages deployment, verify workflow syntax with
  a local parser or a dry run where possible, and keep `workflow_dispatch`
  available for manual refreshes.
