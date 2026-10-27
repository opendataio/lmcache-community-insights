const DATA_URL = "data/lmcache-metrics.json";
const REPO = "LMCache/LMCache";
const THEME_KEY = "lmcacheInsightsTheme";
const WINDOW_KEY = "lmcacheInsightsWindow";
const DAY_CONFIG_KEY = "lmcacheInsightsDayConfig";

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

let metrics = null;
let charts = [];
// Daily rows shown everywhere (charts, KPIs, table). Re-bucketed client-side
// from raw PR events under the visitor's day window, or the stored server rows
// when the data file predates raw events.
let rows = [];
let usingClientWindow = false;
let dayConfig = loadDayConfig();

const datasetVisibility = new Map([
  ["prFlowChart:Opened", false],
  ["prFlowChart:Closed", false],
  ["prFlowChart:Merged", false],
  ["prFlowChart:Net", true],
]);

const colors = {
  opened: "#5d8dff",
  closed: "#ff6878",
  merged: "#58d487",
  net: "#f1a55b",
  open: "#4fd1a1",
  stars: "#f7c65f",
  forks: "#a997ff",
  contributors: "#5fc8dc",
};

const legendHelp = {
  Opened: "Pull requests (drafts excluded) opened within this day window.",
  Closed: "Pull requests (drafts excluded) closed within this day window, including merged PRs.",
  Merged: "Pull requests merged within this day window.",
  Net: "Daily opened PRs minus daily closed PRs. Positive means the open backlog grew that day.",
  "Open PRs EOD": "Pull requests (drafts excluded) still open at the end of that day window.",
  Stars: "Cumulative current stargazers by their visible starred_at date.",
  "Forks (visible)": "Cumulative timestamp-visible forks. GitHub's current fork total can include extra records.",
  Contributors: "Observed contributor count from the GitHub repository homepage. Missing dates have no snapshot.",
  "Commit authors (estimate)": "Estimated unique default-branch commit authors; a different metric from GitHub's contributor count.",
};

function repoUrl(path = "") {
  return `https://github.com/${REPO}${path}`;
}

function searchUrl(query) {
  return repoUrl(`/pulls?q=${encodeURIComponent(query)}`);
}

function formatNumber(value) {
  return numberFormatter.format(value ?? 0);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function loadDayConfig() {
  const defaults = { ...DayWindow.DAY_WINDOW_DEFAULTS };
  try {
    const stored = JSON.parse(localStorage.getItem(DAY_CONFIG_KEY));
    if (stored && typeof stored === "object") {
      return {
        tz: DayWindow.TZ_OPTIONS.some((option) => option.value === stored.tz)
          ? stored.tz
          : defaults.tz,
        dayStartHour:
          Number.isInteger(stored.dayStartHour) &&
          stored.dayStartHour >= 0 &&
          stored.dayStartHour <= 23
            ? stored.dayStartHour
            : defaults.dayStartHour,
      };
    }
  } catch (error) {
    console.warn("Ignoring invalid day-window config", error);
  }
  return defaults;
}

function saveDayConfig() {
  localStorage.setItem(DAY_CONFIG_KEY, JSON.stringify(dayConfig));
}

function refreshRows() {
  if (!metrics) {
    rows = [];
    return;
  }
  const hasEvents =
    metrics.events && Array.isArray(metrics.events.prs) && metrics.events.prs.length > 0;
  if (hasEvents) {
    rows = DayWindow.buildDailyRows(metrics.events, dayConfig, Date.now());
    usingClientWindow = true;
  } else {
    rows = Array.isArray(metrics.daily) ? metrics.daily : [];
    usingClientWindow = false;
  }
}

function latestRows() {
  const today = rows.at(-1) ?? {};
  const yesterday = rows.at(-2) ?? {};
  return { today, yesterday };
}

function selectedRows() {
  const selectedWindow = document.getElementById("windowSelect").value;
  if (!rows.length || selectedWindow === "all") {
    return rows;
  }
  return rows.slice(-Number(selectedWindow));
}

/**
 * Map a server-side cumulative field onto the current x-axis labels.
 * carry=true carries the last known value forward (stars/forks/estimate);
 * carry=false leaves gaps where no observation exists (contributor snapshots).
 */
function serverSeries(field, labels, carry) {
  const byDate = new Map();
  for (const row of metrics.daily || []) {
    byDate.set(row.date, row[field]);
  }
  let last = null;
  return labels.map((label) => {
    if (byDate.has(label)) {
      last = byDate.get(label);
    }
    return carry ? last : byDate.has(label) ? byDate.get(label) : null;
  });
}

function metricDelta(current, previous) {
  const diff = (current ?? 0) - (previous ?? 0);
  if (diff > 0) {
    return { className: "delta-up", text: `▲ ${formatNumber(diff)} vs yesterday` };
  }
  if (diff < 0) {
    return { className: "delta-down", text: `▼ ${formatNumber(Math.abs(diff))} vs yesterday` };
  }
  return { className: "delta-flat", text: "0 vs yesterday" };
}

function renderDelta(id, current, previous) {
  const element = document.getElementById(id);
  const delta = metricDelta(current, previous);
  element.className = `delta ${delta.className}`;
  element.textContent = delta.text;
}

function destroyCharts() {
  charts.forEach((chart) => chart.destroy());
  charts = [];
}

function lineDataset(chartId, label, data, color) {
  const visibilityKey = `${chartId}:${label}`;
  return {
    type: "line",
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    hidden: datasetVisibility.has(visibilityKey) ? !datasetVisibility.get(visibilityKey) : false,
    pointRadius: 0,
    pointHoverRadius: 3,
    tension: 0.22,
  };
}

function barDataset(chartId, label, data, color) {
  const visibilityKey = `${chartId}:${label}`;
  return {
    type: "bar",
    label,
    data,
    backgroundColor: color,
    borderRadius: 4,
    borderSkipped: false,
    hidden: datasetVisibility.has(visibilityKey) ? !datasetVisibility.get(visibilityKey) : false,
  };
}

function sharedOptions() {
  const muted = cssVar("--muted");
  const line = cssVar("--line");
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) =>
            `${context.dataset.label}: ${formatNumber(context.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        border: {
          color: line,
        },
        grid: {
          display: false,
        },
        ticks: {
          color: muted,
          maxTicksLimit: 8,
        },
      },
      y: {
        beginAtZero: true,
        border: {
          color: line,
        },
        grid: {
          color: line,
        },
        ticks: {
          color: muted,
          precision: 0,
        },
      },
    },
  };
}

function createLegend(chart, legendId) {
  const legend = document.getElementById(legendId);
  legend.replaceChildren(
    ...chart.data.datasets.map((dataset, index) => {
      const button = document.createElement("button");
      const visible = chart.isDatasetVisible(index);
      button.type = "button";
      button.textContent = dataset.label;
      button.title = legendHelp[dataset.label] ?? dataset.label;
      button.setAttribute("aria-label", `${dataset.label}: ${button.title}`);
      button.setAttribute("aria-pressed", String(visible));
      button.style.setProperty("--legend-color", dataset.borderColor ?? dataset.backgroundColor);
      button.addEventListener("click", () => {
        const nextVisible = !chart.isDatasetVisible(index);
        chart.setDatasetVisibility(index, nextVisible);
        datasetVisibility.set(`${chart.canvas.id}:${dataset.label}`, nextVisible);
        button.setAttribute("aria-pressed", String(nextVisible));
        chart.update();
      });
      return button;
    }),
  );
}

function makeChart(canvasId, legendId, config) {
  const chart = new Chart(document.getElementById(canvasId), config);
  charts.push(chart);
  createLegend(chart, legendId);
  return chart;
}

function renderCharts() {
  const windowRows = selectedRows();
  const labels = windowRows.map((row) => row.date);

  destroyCharts();

  makeChart("prFlowChart", "prFlowLegend", {
    type: "bar",
    data: {
      labels,
      datasets: [
        barDataset("prFlowChart", "Opened", windowRows.map((row) => row.prs_opened), colors.opened),
        barDataset("prFlowChart", "Closed", windowRows.map((row) => row.prs_closed), colors.closed),
        barDataset("prFlowChart", "Merged", windowRows.map((row) => row.prs_merged), colors.merged),
        lineDataset("prFlowChart", "Net", windowRows.map((row) => row.pr_net), colors.net),
      ],
    },
    options: sharedOptions(),
  });

  makeChart("openBacklogChart", "openBacklogLegend", {
    type: "line",
    data: {
      labels,
      datasets: [
        lineDataset(
          "openBacklogChart",
          "Open PRs EOD",
          windowRows.map((row) => row.prs_open_eod),
          colors.open,
        ),
      ],
    },
    options: sharedOptions(),
  });

  makeChart("starForkChart", "starForkLegend", {
    type: "line",
    data: {
      labels,
      datasets: [
        lineDataset("starForkChart", "Stars", serverSeries("stars_total", labels, true), colors.stars),
        lineDataset(
          "starForkChart",
          "Forks (visible)",
          serverSeries("forks_total", labels, true),
          colors.forks,
        ),
      ],
    },
    options: sharedOptions(),
  });

  makeChart("contributorsChart", "contributorsLegend", {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          ...lineDataset(
            "contributorsChart",
            "Contributors",
            serverSeries("github_contributors_total", labels, false),
            colors.contributors,
          ),
          pointRadius: 3,
          spanGaps: false,
          tension: 0,
        },
        {
          ...lineDataset(
            "contributorsChart",
            "Commit authors (estimate)",
            serverSeries("contributors_total", labels, true),
            cssVar("--muted"),
          ),
          borderDash: [5, 5],
        },
      ],
    },
    options: sharedOptions(),
  });
}

function renderRecentTable() {
  const body = document.getElementById("recentTable");
  body.replaceChildren(
    ...rows.slice(-14).reverse().map((row) => {
      const tr = document.createElement("tr");
      const netClass = row.pr_net > 0 ? "net-pos" : row.pr_net < 0 ? "net-neg" : "";
      tr.innerHTML = `
        <td>${row.date}</td>
        <td>${formatNumber(row.prs_opened)}</td>
        <td>${formatNumber(row.prs_closed)}</td>
        <td>${formatNumber(row.prs_merged)}</td>
        <td class="${netClass}">${row.pr_net > 0 ? "+" : ""}${formatNumber(row.pr_net)}</td>
        <td>${formatNumber(row.prs_open_eod)}</td>
      `;
      return tr;
    }),
  );
}

function setKpiLinks(today) {
  const day = today.date;
  document.getElementById("netPrLink").href = "#pr-flow";
  document.getElementById("openPrLink").href = searchUrl("is:pr is:open -is:draft");
  document.getElementById("mergedPrLink").href = searchUrl(`is:pr is:merged merged:${day}`);
  document.getElementById("closedPrLink").href = searchUrl(`is:pr is:closed -is:draft closed:${day}`);
}

function renderSummary() {
  const { today, yesterday } = latestRows();
  const currentNet = today.pr_net ?? 0;
  setText("currentNetPr", currentNet > 0 ? `+${formatNumber(currentNet)}` : formatNumber(currentNet));
  setText("currentOpenPrs", formatNumber(metrics.summary.current_open_prs));
  setText("currentMergedPrs", formatNumber(today.prs_merged));
  setText("currentClosedPrs", formatNumber(today.prs_closed));
  setText(
    "currentContributors",
    metrics.summary.current_contributors == null ? "—" : formatNumber(metrics.summary.current_contributors),
  );
  const firstSnapshot = metrics.daily.find((row) => row.github_contributors_total != null);
  setText(
    "contributorsHistoryNote",
    firstSnapshot
      ? `GitHub count snapshots since ${firstSnapshot.date}. Dashed line: commit-author estimate.`
      : "No GitHub count snapshots yet. Dashed line: commit-author estimate.",
  );

  renderDelta("netPrDelta", today.pr_net, yesterday.pr_net);
  renderDelta("openPrDelta", today.prs_open_eod, yesterday.prs_open_eod);
  renderDelta("mergedPrDelta", today.prs_merged, yesterday.prs_merged);
  renderDelta("closedPrDelta", today.prs_closed, yesterday.prs_closed);
  setKpiLinks(today);

  const generated = metrics.generated_at
    ? dateFormatter.format(new Date(metrics.generated_at))
    : "No generated timestamp";
  setText("updatedAt", `Updated ${generated} (${metrics.timezone})`);
}

function renderDayWindowNote() {
  const note = document.getElementById("dayWindowNote");
  if (!usingClientWindow) {
    note.textContent =
      "Data not yet refreshed with raw PR events — showing stored daily values. " +
      "Run the collector or the nightly workflow to enable per-visitor day windows.";
    note.className = "day-note day-note-warn";
    return;
  }
  const hour = pad2(dayConfig.dayStartHour);
  note.textContent =
    `Day window: ${hour}:00 → next day ${hour}:00 (${tzLabel(dayConfig.tz)}) · Draft PRs excluded`;
  note.className = "day-note";
}

function tzLabel(value) {
  const option = DayWindow.TZ_OPTIONS.find((item) => item.value === value);
  return option ? option.label : value;
}

function renderCommands() {
  const { today } = latestRows();
  const day = today.date;
  const hour = pad2(dayConfig.dayStartHour);
  const commands = [
    "# Current open PRs excluding drafts, plus current stars and forks",
    "gh api --paginate '/repos/LMCache/LMCache/pulls?state=open&per_page=100' \\",
    "  --jq '[.[] | select(.draft | not)] | length'",
    "gh api graphql \\",
    "  -f owner=LMCache -f name=LMCache \\",
    "  -f query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){stargazerCount forkCount}}'",
    "",
    "# Contributors: same source as the GitHub repository homepage",
    "curl -fsSL -H 'Accept: application/json' https://github.com/LMCache/LMCache/_sidebar |",
    '  python3 -c \'import json,sys; print(json.load(sys.stdin)["contributors"]["contributorCount"])\'',
    "",
    `# Today's PR flow in your day window (${tzLabel(dayConfig.tz)}, starts ${hour}:00, drafts excluded)`,
    `DAY=${day}`,
    `TZ=${dayConfig.tz} DAY_START=${dayConfig.dayStartHour}`,
    "gh api --paginate '/repos/LMCache/LMCache/pulls?state=all&per_page=100' \\",
    "  --jq '.[] | select(.draft | not) | [.created_at, .closed_at, .merged_at] | @tsv' | \\",
    '  DAY="$DAY" TZ="$TZ" DAY_START="$DAY_START" python3 -c \'import os,sys; from datetime import datetime,timedelta; from zoneinfo import ZoneInfo; day=os.environ["DAY"]; tz=ZoneInfo(os.environ["TZ"]); h=int(os.environ["DAY_START"]); counts={"opened":0,"closed":0,"merged":0};',
    'def bucket(value):',
    '    if not value: return None',
    '    dt=datetime.fromisoformat(value.replace("Z","+00:00")).astimezone(tz)',
    '    d=dt.date()',
    '    if dt.hour < h: d=d-timedelta(days=1)',
    '    return d.isoformat()',
    'for line in sys.stdin:',
    '    created, closed, merged = line.rstrip("\\n").split("\\t")',
    '    counts["opened"] += bucket(created)==day; counts["closed"] += bucket(closed)==day; counts["merged"] += bucket(merged)==day',
    'print("opened={o} closed={c} merged={m} net={n}".format(o=counts["opened"], c=counts["closed"], m=counts["merged"], n=counts["opened"]-counts["closed"]))\'',
  ];
  setText("ghCommands", commands.join("\n"));
}

function renderAll() {
  renderSummary();
  renderRecentTable();
  renderDayWindowNote();
  renderCommands();
  renderCharts();
}

function applyTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(THEME_KEY, nextTheme);
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeOption === nextTheme));
  });
  if (metrics) {
    renderCharts();
  }
}

function populateDayConfigControls() {
  const tzSelect = document.getElementById("tzSelect");
  tzSelect.replaceChildren(
    ...DayWindow.TZ_OPTIONS.map((option) => {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      return el;
    }),
  );
  tzSelect.value = dayConfig.tz;

  const dayStartSelect = document.getElementById("dayStartSelect");
  dayStartSelect.replaceChildren(
    ...Array.from({ length: 24 }, (_, hour) => {
      const el = document.createElement("option");
      el.value = String(hour);
      el.textContent = `${pad2(hour)}:00`;
      return el;
    }),
  );
  dayStartSelect.value = String(dayConfig.dayStartHour);
}

function initPreferences() {
  const storedWindow = localStorage.getItem(WINDOW_KEY) ?? "30";
  const windowSelect = document.getElementById("windowSelect");
  if ([...windowSelect.options].some((option) => option.value === storedWindow)) {
    windowSelect.value = storedWindow;
  }

  populateDayConfigControls();
  document.getElementById("tzSelect").addEventListener("change", (event) => {
    dayConfig.tz = event.target.value;
    saveDayConfig();
    refreshRows();
    renderAll();
  });
  document.getElementById("dayStartSelect").addEventListener("change", (event) => {
    dayConfig.dayStartHour = Number(event.target.value);
    saveDayConfig();
    refreshRows();
    renderAll();
  });

  applyTheme(localStorage.getItem(THEME_KEY) ?? "dark");
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeOption);
    });
  });

  windowSelect.addEventListener("change", () => {
    localStorage.setItem(WINDOW_KEY, windowSelect.value);
    renderCharts();
  });
}

async function init() {
  initPreferences();
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch ${DATA_URL}: ${response.status}`);
  }
  metrics = await response.json();
  refreshRows();
  renderAll();
}

init().catch((error) => {
  console.error(error);
  setText("updatedAt", "Failed to load data");
});
