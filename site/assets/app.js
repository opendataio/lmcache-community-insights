const DATA_URL = "data/lmcache-metrics.json";

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

let metrics = null;
let charts = [];

const colors = {
  opened: "#2f66d0",
  closed: "#c43d4b",
  merged: "#23834b",
  net: "#b4521e",
  open: "#1f7a5c",
  stars: "#a15c00",
  forks: "#6b5bd6",
  contributors: "#21758a",
};

function formatNumber(value) {
  return numberFormatter.format(value ?? 0);
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function lastNDays(days) {
  if (!metrics?.daily?.length || days === "all") {
    return metrics.daily;
  }
  return metrics.daily.slice(-Number(days));
}

function destroyCharts() {
  charts.forEach((chart) => chart.destroy());
  charts = [];
}

function lineDataset(label, data, color, axisId = "y") {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 3,
    tension: 0.22,
    yAxisID: axisId,
  };
}

function barDataset(label, data, color) {
  return {
    label,
    data,
    backgroundColor: color,
    borderRadius: 4,
    borderSkipped: false,
  };
}

function sharedOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        labels: {
          boxWidth: 12,
          boxHeight: 12,
          usePointStyle: true,
        },
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
        grid: {
          display: false,
        },
        ticks: {
          maxTicksLimit: 10,
        },
      },
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0,
        },
      },
    },
  };
}

function renderCharts() {
  const selectedWindow = document.getElementById("windowSelect").value;
  const rows = lastNDays(selectedWindow);
  const labels = rows.map((row) => row.date);

  destroyCharts();

  charts.push(
    new Chart(document.getElementById("prFlowChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          barDataset("Opened", rows.map((row) => row.prs_opened), colors.opened),
          barDataset("Closed", rows.map((row) => row.prs_closed), colors.closed),
          barDataset("Merged", rows.map((row) => row.prs_merged), colors.merged),
          lineDataset("Net", rows.map((row) => row.pr_net), colors.net),
        ],
      },
      options: sharedOptions(),
    }),
  );

  charts.push(
    new Chart(document.getElementById("openBacklogChart"), {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset(
            "Open PRs EOD",
            rows.map((row) => row.prs_open_eod),
            colors.open,
          ),
        ],
      },
      options: sharedOptions(),
    }),
  );

  charts.push(
    new Chart(document.getElementById("starForkChart"), {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Stars", rows.map((row) => row.stars_total), colors.stars),
          lineDataset(
            "Forks (visible)",
            rows.map((row) => row.forks_total),
            colors.forks,
          ),
        ],
      },
      options: sharedOptions(),
    }),
  );

  charts.push(
    new Chart(document.getElementById("contributorsChart"), {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset(
            "Contributors",
            rows.map((row) => row.contributors_total),
            colors.contributors,
          ),
        ],
      },
      options: sharedOptions(),
    }),
  );
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

function renderSummary() {
  setText("currentOpenPrs", formatNumber(metrics.summary.current_open_prs));
  setText("currentStars", formatNumber(metrics.summary.current_stars));
  setText("currentForks", formatNumber(metrics.summary.current_forks));
  setText("currentContributors", formatNumber(metrics.summary.estimated_contributors));
  const untrackedForks = metrics.summary.untracked_forks ?? 0;
  setText(
    "forkCoverage",
    untrackedForks > 0
      ? `${formatNumber(metrics.summary.visible_forks_tracked)} timestamp-visible`
      : "",
  );

  const generated = metrics.generated_at
    ? dateFormatter.format(new Date(metrics.generated_at))
    : "No generated timestamp";
  setText("updatedAt", `Updated ${generated} (${metrics.timezone})`);
}

async function init() {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch ${DATA_URL}: ${response.status}`);
  }
  metrics = await response.json();
  renderSummary();
  renderRecentTable();
  renderCharts();
  document.getElementById("windowSelect").addEventListener("change", renderCharts);
}

init().catch((error) => {
  console.error(error);
  setText("updatedAt", "Failed to load data");
});
