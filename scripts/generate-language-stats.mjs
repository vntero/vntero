#!/usr/bin/env node
// Aggregates language byte counts across all of the account's repos (private included)
// and renders a horizontal bar chart SVG.
import { writeFile } from "node:fs/promises";

const USERNAME = process.env.GH_USERNAME || "vntero";
const TOKEN = process.env.GH_TOKEN;
const TOP_N = 8;
const OUTPUT_PATH = new URL("../assets/languages.svg", import.meta.url);

if (!TOKEN) {
  console.error("Missing GH_TOKEN environment variable.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function ghFetch(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} for ${url}: ${await res.text()}`);
  }
  return res.json();
}

async function listAllOwnedRepos() {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await ghFetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner`
    );
    if (batch.length === 0) break;
    repos.push(...batch.filter((r) => !r.fork));
    page += 1;
  }
  return repos;
}

async function aggregateLanguages(repos) {
  const totals = {};
  for (const repo of repos) {
    const langs = await ghFetch(repo.languages_url);
    for (const [lang, bytes] of Object.entries(langs)) {
      totals[lang] = (totals[lang] || 0) + bytes;
    }
  }
  return totals;
}

// Approximate GitHub linguist colors for common languages; anything else gets a palette fallback.
const LANGUAGE_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Svelte: "#ff3e00",
  Rust: "#dea584",
  Swift: "#F05138",
  Go: "#00ADD8",
  Python: "#3572A5",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Shell: "#89e051",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  Dockerfile: "#384d54",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Kotlin: "#A97BFF",
};
const FALLBACK_PALETTE = ["#8da0cb", "#fc8d62", "#66c2a5", "#e78ac3", "#a6d854", "#ffd92f"];

function colorFor(lang, fallbackIndex) {
  return LANGUAGE_COLORS[lang] || FALLBACK_PALETTE[fallbackIndex % FALLBACK_PALETTE.length];
}

function buildSvg(totals) {
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, bytes]) => sum + bytes, 0);

  const top = sorted.slice(0, TOP_N);
  const rest = sorted.slice(TOP_N);
  const restBytes = rest.reduce((sum, [, bytes]) => sum + bytes, 0);
  if (restBytes > 0) top.push(["Other", restBytes]);

  const rows = top.map(([lang, bytes], i) => ({
    lang,
    pct: (bytes / total) * 100,
    color: lang === "Other" ? "#8b949e" : colorFor(lang, i),
  }));

  const width = 420;
  const rowHeight = 32;
  const paddingTop = 50;
  const height = paddingTop + rows.length * rowHeight + 20;
  const barX = 150;
  const barMaxWidth = width - barX - 60;

  const rowsSvg = rows
    .map((row, i) => {
      const y = paddingTop + i * rowHeight;
      const barWidth = Math.max((row.pct / 100) * barMaxWidth, 2);
      return `
    <text x="20" y="${y + 15}" class="label">${escapeXml(row.lang)}</text>
    <rect x="${barX}" y="${y + 4}" width="${barMaxWidth}" height="10" rx="5" class="track" />
    <rect x="${barX}" y="${y + 4}" width="${barWidth}" height="10" rx="5" fill="${row.color}">
      <animate attributeName="width" from="0" to="${barWidth}" dur="0.8s" fill="freeze" />
    </rect>
    <text x="${barX + barMaxWidth + 10}" y="${y + 15}" class="pct">${row.pct.toFixed(1)}%</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Segoe UI', Ubuntu, Sans-Serif">
  <style>
    .title { fill: #58a6ff; font-size: 16px; font-weight: 600; }
    .label { fill: #c9d1d9; font-size: 13px; }
    .pct { fill: #8b949e; font-size: 12px; }
    .track { fill: #21262d; }
    svg { background-color: #0d1117; }
  </style>
  <rect width="${width}" height="${height}" rx="8" fill="#0d1117" />
  <text x="20" y="28" class="title">Most Used Languages</text>
  ${rowsSvg}
</svg>`;
}

function escapeXml(str) {
  return str.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

const repos = await listAllOwnedRepos();
const totals = await aggregateLanguages(repos);
const svg = buildSvg(totals);

await writeFile(OUTPUT_PATH, svg);
console.log(`Wrote ${OUTPUT_PATH.pathname} from ${repos.length} repos.`);
