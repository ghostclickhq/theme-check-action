// GhostClick theme check: the step that talks to GhostClick (GC-203).
//
// Starts one check per journey / page monitor against the theme
// (POST /api/ci/theme-checks), waits for them (GET ...?ids=), writes the job
// summary, optionally comments on the pull request, and exits 1 when a check
// failed. Node 20+, no dependencies. The pure parts are exported for
// ghostclick-check.test.mjs (`node --test`).

import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const COMMENT_MARKER = "<!-- ghostclick-theme-check -->";
const POLL_MS = 15_000;

export function parseBool(value, fallback) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "") return fallback;
  return !["false", "0", "no", "off"].includes(v);
}

/** The pull request number and head commit, when the workflow runs for one. */
export function pullRequestFrom(event) {
  const pr = event?.pull_request;
  if (!pr || typeof pr.number !== "number") return null;
  return { number: pr.number, sha: pr.head?.sha ?? null };
}

const ICON = { passed: "✅", failed: "❌", error: "⚠️", queued: "⏳", running: "⏳" };
const STATE_WORD = { passed: "Passed", failed: "Failed", error: "Did not finish", queued: "Did not start in time", running: "Still running" };

function cell(text) {
  return String(text ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Markdown for the job summary and the pull request comment. */
export function buildSummary({ verdict, store, theme, notStarted = [], timedOut = false }) {
  const failed = verdict.state !== "passed" || notStarted.length > 0 || timedOut;
  const themeLabel = theme?.name ? `${theme.name} (${theme.id})` : theme?.id;
  const lines = [
    COMMENT_MARKER,
    `## ${failed ? "❌" : "✅"} GhostClick theme check`,
    "",
    `Theme ${themeLabel} on ${store}: ${verdict.passed} passed, ${verdict.failed} failed${verdict.pending ? `, ${verdict.pending} unfinished` : ""}.`,
    "",
    "| Check | Result | Details |",
    "| --- | --- | --- |",
  ];
  for (const c of verdict.checks) {
    const kind = c.kind === "page" ? "Page" : "Journey";
    const score = c.kind === "page" && c.score != null ? ` · score ${c.score}` : "";
    const details = c.state === "passed" && c.kind === "journey"
      ? c.devices.map((d) => d.device).join(" and ") + " completed"
      : c.reasons.slice(0, 3).join("; ");
    lines.push(
      `| ${kind}: [${cell(c.name)}](${c.report_url}) | ${ICON[c.state] ?? ""} ${STATE_WORD[c.state] ?? c.state}${score} | ${cell(details)} |`,
    );
  }
  for (const n of notStarted) {
    lines.push(`| ${cell(n.name)} | ⚠️ Not run | ${cell(n.reason)} |`);
  }
  if (timedOut) {
    lines.push("", "The checks did not all finish in time. Open the reports in GhostClick for the results.");
  }
  return { markdown: lines.join("\n") + "\n", failed };
}

async function api(baseUrl, token, path, init = {}) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "ghostclick-theme-check-action", ...(init.headers ?? {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

async function upsertPullRequestComment({ token, repository, number, markdown }) {
  const base = `${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${repository}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "ghostclick-theme-check-action" };
  const list = await fetch(`${base}/issues/${number}/comments?per_page=100`, { headers });
  const comments = list.ok ? await list.json() : [];
  const mine = Array.isArray(comments) ? comments.find((c) => typeof c.body === "string" && c.body.includes(COMMENT_MARKER)) : null;
  const res = mine
    ? await fetch(`${base}/issues/comments/${mine.id}`, { method: "PATCH", headers, body: JSON.stringify({ body: markdown }) })
    : await fetch(`${base}/issues/${number}/comments`, { method: "POST", headers, body: JSON.stringify({ body: markdown }) });
  if (!res.ok) console.log(`::warning title=GhostClick::Could not comment on the pull request (${res.status}). Does the job have pull-requests: write?`);
}

function output(name, value, env = process.env) {
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `${name}<<GHOSTCLICK_EOF\n${value}\nGHOSTCLICK_EOF\n`);
  }
}

function fail(message, env = process.env) {
  console.log(`::error title=GhostClick::${message}`);
  output("result", "failed", env);
  process.exitCode = 1;
}

export async function main(env = process.env) {
  const token = env.GHOSTCLICK_TOKEN?.trim();
  const store = env.GHOSTCLICK_STORE?.trim();
  const themeId = env.GHOSTCLICK_THEME_ID?.trim();
  const baseUrl = env.GHOSTCLICK_API_URL?.trim() || "https://www.getghostclick.com";
  const failOnFailure = parseBool(env.GHOSTCLICK_FAIL_ON_FAILURE, true);
  const minPageScore = Math.max(0, Math.min(100, Number(env.GHOSTCLICK_MIN_PAGE_SCORE) || 0));
  const timeoutMs = Math.max(1, Number(env.GHOSTCLICK_TIMEOUT_MINUTES) || 30) * 60_000;

  if (!token) return fail("Set ghostclick_token to your GhostClick GitHub key (a repository secret). Make one in GhostClick, Settings, GitHub Action.", env);
  if (!store) return fail("Set store to your .myshopify.com address.", env);
  if (!themeId) return fail("No theme to test: pass theme_id, or theme_access_password so the Action can push one.", env);

  let event = null;
  try {
    if (env.GITHUB_EVENT_PATH) event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    event = null;
  }
  const pr = pullRequestFrom(event);

  const start = await api(baseUrl, token, "/api/ci/theme-checks", {
    method: "POST",
    body: JSON.stringify({
      store,
      theme_id: themeId,
      commit: pr?.sha ?? env.GITHUB_SHA ?? null,
      ref: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || null,
      repository: env.GITHUB_REPOSITORY ?? null,
      pull_request: pr?.number ?? null,
    }),
  });
  if (!start.ok) {
    return fail(start.body?.error ?? `GhostClick answered ${start.status}.`, env);
  }

  const { checks, not_started: notStarted = [], theme } = start.body;
  output("theme_id", themeId, env);
  console.log(`Testing theme ${theme?.name ? `"${theme.name}" ` : ""}(${themeId}) on ${start.body.store} with ${checks.length} check${checks.length === 1 ? "" : "s"}:`);
  for (const c of checks) console.log(`  ${c.kind === "page" ? "Page" : "Journey"}: ${c.name}`);
  for (const n of notStarted) console.log(`::warning title=GhostClick::${n.name} was not run: ${n.reason}`);

  const ids = checks.map((c) => c.audit_id).join(",");
  const deadline = Date.now() + timeoutMs;
  let verdict = null;
  let lastLine = "";
  for (;;) {
    const status = await api(baseUrl, token, `/api/ci/theme-checks?ids=${ids}&min_page_score=${minPageScore}`);
    if (status.ok) {
      verdict = status.body;
      const line = `${verdict.passed} passed, ${verdict.failed} failed, ${verdict.pending} still running`;
      if (line !== lastLine) console.log(line);
      lastLine = line;
      if (verdict.state !== "pending") break;
    } else {
      console.log(`GhostClick answered ${status.status} while checking; trying again.`);
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  if (!verdict) return fail("GhostClick did not answer while the checks ran.", env);
  const timedOut = verdict.state === "pending";
  const { markdown, failed } = buildSummary({ verdict, store: start.body.store, theme: theme ?? { id: themeId }, notStarted, timedOut });

  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  output("report_urls", verdict.checks.map((c) => c.report_url).join("\n"), env);
  for (const c of verdict.checks) {
    if (c.state === "failed" || c.state === "error") {
      console.log(`::error title=GhostClick: ${c.name}::${c.reasons.join("; ") || "failed"} ${c.report_url}`);
    }
  }

  if (env.GHOSTCLICK_GITHUB_TOKEN && pr && env.GITHUB_REPOSITORY) {
    await upsertPullRequestComment({ token: env.GHOSTCLICK_GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, number: pr.number, markdown });
  }

  output("result", failed ? "failed" : "passed", env);
  console.log(failed ? "GhostClick found a problem with this theme." : "Every GhostClick check passed on this theme.");
  if (failed && failOnFailure) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
}
