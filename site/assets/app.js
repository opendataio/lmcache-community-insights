const DATA_URL = "data/lmcache-metrics.json";
const REPO = "LMCache/LMCache";
const THEME_KEY = "lmcacheInsightsTheme";
const WINDOW_KEY = "lmcacheInsightsWindow";

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

let metrics = null;
let charts = [];
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
  Opened: "Pull requests whose created_at date falls on this day.",
  Closed: "Pull requests whose closed_at date falls on this day, including merged PRs.",
  Merged: "Pull requests whose merged_at date falls on this day.",
  Net: "Daily opened PRs minus daily closed PRs. Positive means the open backlog grew that day.",
  "Open PRs EOD": "Pull requests still open at the end of that day.",
  Stars: "Cumulative current stargazers by their visible starred_at date.",
  "Forks (visible)": "Cumulative timestamp-visible forks. GitHub's current fork total can include extra records.",
  Contributors: "Estimated cumulative default-branch commit authors by first-seen commit date.",
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

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function latestRows() {
  const today = metrics.daily.at(-1) ?? {};
  const yesterday = metrics.daily.at(-2) ?? {};
  return { today, yesterday };
}

function selectedRows() {
  const selectedWindow = document.getElementById("windowSelect").value;
  if (!metrics?.daily?.length || selectedWindow === "all") {
    return metrics.daily;
  }
  return metrics.daily.slice(-Number(selectedWindow));
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
  const rows = selectedRows();
  const labels = rows.map((row) => row.date);

  destroyCharts();

  makeChart("prFlowChart", "prFlowLegend", {
    type: "bar",
    data: {
      labels,
      datasets: [
        barDataset("prFlowChart", "Opened", rows.map((row) => row.prs_opened), colors.opened),
        barDataset("prFlowChart", "Closed", rows.map((row) => row.prs_closed), colors.closed),
        barDataset("prFlowChart", "Merged", rows.map((row) => row.prs_merged), colors.merged),
        lineDataset("prFlowChart", "Net", rows.map((row) => row.pr_net), colors.net),
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
          rows.map((row) => row.prs_open_eod),
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
        lineDataset("starForkChart", "Stars", rows.map((row) => row.stars_total), colors.stars),
        lineDataset(
          "starForkChart",
          "Forks (visible)",
          rows.map((row) => row.forks_total),
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
        lineDataset(
          "contributorsChart",
          "Contributors",
          rows.map((row) => row.contributors_total),
          colors.contributors,
        ),
      ],
    },
    options: sharedOptions(),
  });
}

function renderRecentTable() {
  const body = document.getElementById("recentTable");
  body.replaceChildren(
    ...metrics.daily.slice(-14).reverse().map((row) => {
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
  document.getElementById("openPrLink").href = searchUrl("is:pr is:open");
  document.getElementById("mergedPrLink").href = searchUrl(`is:pr merged:${day}`);
  document.getElementById("closedPrLink").href = searchUrl(`is:pr closed:${day}`);
}

function renderSummary() {
  const { today, yesterday } = latestRows();
  const currentNet = today.pr_net ?? 0;
  setText("currentNetPr", currentNet > 0 ? `+${formatNumber(currentNet)}` : formatNumber(currentNet));
  setText("currentOpenPrs", formatNumber(metrics.summary.current_open_prs));
  setText("currentMergedPrs", formatNumber(today.prs_merged));
  setText("currentClosedPrs", formatNumber(today.prs_closed));

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

function renderCommands() {
  const { today } = latestRows();
  const day = today.date;
  const commands = [
    "# Current open PRs, stars, and forks",
    "gh api graphql \\",
    "  -f owner=LMCache -f name=LMCache \\",
    "  -f query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN){totalCount} stargazerCount forkCount}}'",
    "",
    "# Today's PR flow in Asia/Shanghai, matching this dashboard's day boundary",
    `DAY=${day}`,
    "gh api --paginate '/repos/LMCache/LMCache/pulls?state=all&per_page=100' \\",
    "  --jq '.[] | [.created_at, .closed_at, .merged_at] | @tsv' | \\",
    '  DAY="$DAY" TZ=Asia/Shanghai python3 -c \'import os,sys; from datetime import datetime; from zoneinfo import ZoneInfo; day=os.environ["DAY"]; tz=ZoneInfo(os.environ["TZ"]); counts={"opened":0,"closed":0,"merged":0};',
    'for line in sys.stdin:',
    '    created, closed, merged = line.rstrip("\\n").split("\\t")',
    '    def same_day(value): return bool(value) and datetime.fromisoformat(value.replace("Z","+00:00")).astimezone(tz).date().isoformat() == day',
    '    counts["opened"] += same_day(created); counts["closed"] += same_day(closed); counts["merged"] += same_day(merged)',
    'print("opened={opened} closed={closed} merged={merged} net={net}".format(opened=counts["opened"], closed=counts["closed"], merged=counts["merged"], net=counts["opened"]-counts["closed"]))\'',
  ];
  setText("ghCommands", commands.join("\n"));
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

function initPreferences() {
  const storedWindow = localStorage.getItem(WINDOW_KEY) ?? "30";
  const windowSelect = document.getElementById("windowSelect");
  if ([...windowSelect.options].some((option) => option.value === storedWindow)) {
    windowSelect.value = storedWindow;
  }

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
  renderSummary();
  renderRecentTable();
  renderCommands();
  renderCharts();
}

init().catch((error) => {
  console.error(error);
  setText("updatedAt", "Failed to load data");
});
