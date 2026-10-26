import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMENT_MARKER, buildSummary, main, parseBool, pullRequestFrom, resolveTheme, themeFromLink } from "./ghostclick-check.mjs";

test("parseBool reads action inputs", () => {
  assert.equal(parseBool("false", true), false);
  assert.equal(parseBool("", true), true);
  assert.equal(parseBool("yes", false), true);
});

test("pullRequestFrom reads the pull_request event", () => {
  assert.deepEqual(pullRequestFrom({ pull_request: { number: 7, head: { sha: "abc" } } }), { number: 7, sha: "abc" });
  assert.equal(pullRequestFrom({ ref: "refs/heads/main" }), null);
});

test("themeFromLink reads preview links, admin links and bare ids", () => {
  assert.deepEqual(themeFromLink("https://s.myshopify.com/?preview_theme_id=123"), { themeId: "123", store: "s.myshopify.com" });
  assert.deepEqual(themeFromLink("https://shop.example.com/products/hat?preview_theme_id=9&_fd=0"), { themeId: "9", store: null });
  assert.deepEqual(themeFromLink("https://admin.shopify.com/store/s/themes/456/editor"), { themeId: "456", store: null });
  assert.deepEqual(themeFromLink(" 789 "), { themeId: "789", store: null });
  assert.equal(themeFromLink("https://abc.shopifypreview.com"), null);
  assert.equal(themeFromLink("not a link"), null);
});

test("resolveTheme follows a shared preview link to its theme", async () => {
  const hops = [];
  const fakeFetch = async (url) => {
    hops.push(url);
    const location = url === "https://abc.shopifypreview.com" ? "https://s.myshopify.com/?preview_theme_id=55&_ab=0" : null;
    return new Response(null, { status: location ? 302 : 200, headers: location ? { location } : {} });
  };
  assert.deepEqual(await resolveTheme({ previewUrl: "https://abc.shopifypreview.com" }, fakeFetch), { themeId: "55", store: "s.myshopify.com", error: null });
  assert.deepEqual(hops, ["https://abc.shopifypreview.com"]);
});

test("resolveTheme explains what is missing", async () => {
  const noRedirect = async () => new Response("ok");
  assert.match((await resolveTheme({}, noRedirect)).error, /preview_url/);
  assert.match((await resolveTheme({ previewUrl: "https://example.com" }, noRedirect)).error, /Could not find a theme/);
  assert.match((await resolveTheme({ themeId: "abc" }, noRedirect)).error, /theme id number/);
  assert.equal((await resolveTheme({ themeId: "12", previewUrl: "https://x" }, noRedirect)).themeId, "12");
});

const verdict = {
  state: "failed",
  passed: 1,
  failed: 1,
  pending: 0,
  checks: [
    { kind: "journey", name: "Buy a hat", state: "passed", devices: [{ device: "desktop" }, { device: "mobile" }], reasons: [], score: null, report_url: "https://g/audit/1" },
    { kind: "page", name: "Home | page", state: "failed", devices: [], reasons: ["Score 60 is under the minimum of 80"], score: 60, report_url: "https://g/audit/2" },
  ],
};

test("buildSummary writes one row per check and fails on any failure", () => {
  const { markdown, failed } = buildSummary({ verdict, store: "s.myshopify.com", theme: { id: "42", name: "CI" } });
  assert.equal(failed, true);
  assert.ok(markdown.startsWith(COMMENT_MARKER));
  assert.match(markdown, /Theme CI \(42\) on s\.myshopify\.com: 1 passed, 1 failed\./);
  assert.match(markdown, /\| Journey: \[Buy a hat\]\(https:\/\/g\/audit\/1\) \| ✅ Passed \| desktop and mobile completed \|/);
  assert.match(markdown, /Home \\\| page/);
  assert.match(markdown, /❌ Failed · score 60/);
  assert.ok(!markdown.includes("—"), "no em dashes in copy");
});

test("buildSummary fails when a check was not run, even if the rest passed", () => {
  const ok = { ...verdict, state: "passed", failed: 0, checks: [verdict.checks[0]] };
  assert.equal(buildSummary({ verdict: ok, store: "s", theme: { id: "1" } }).failed, false);
  assert.equal(buildSummary({ verdict: ok, store: "s", theme: { id: "1" }, notStarted: [{ name: "x", reason: "allowance" }] }).failed, true);
});

test("main starts the checks, waits, writes the summary and fails the step", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gc-action-"));
  const summary = join(dir, "summary.md");
  const outputs = join(dir, "outputs");
  writeFileSync(summary, "");
  writeFileSync(outputs, "");
  const event = join(dir, "event.json");
  writeFileSync(event, JSON.stringify({ pull_request: { number: 3, head: { sha: "headsha" } } }));

  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    if (String(url).endsWith("/api/ci/theme-checks")) {
      return new Response(JSON.stringify({ store: "s.myshopify.com", theme: { id: "42", name: "CI" }, checks: [{ audit_id: "a1", kind: "journey", name: "Buy a hat" }], not_started: [] }));
    }
    return new Response(JSON.stringify(verdict));
  };
  const before = process.exitCode;
  try {
    await main({
      GHOSTCLICK_TOKEN: "gc_ci_x",
      GHOSTCLICK_PREVIEW_URL: "https://s.myshopify.com/?preview_theme_id=42",
      GHOSTCLICK_MIN_PAGE_SCORE: "80",
      GHOSTCLICK_API_URL: "https://g/",
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: "acme/theme",
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: outputs,
    });
    assert.equal(process.exitCode, 1);
  } finally {
    globalThis.fetch = realFetch;
    process.exitCode = before;
  }

  assert.equal(requests[0].url, "https://g/api/ci/theme-checks");
  assert.deepEqual(requests[0].body, { store: "s.myshopify.com", theme_id: "42", commit: "headsha", ref: null, repository: "acme/theme", pull_request: 3 });
  assert.equal(requests[0].auth, "Bearer gc_ci_x");
  assert.equal(requests[1].url, "https://g/api/ci/theme-checks?ids=a1&min_page_score=80");
  // No github_token: no comment request.
  assert.equal(requests.length, 2);
  assert.match(readFileSync(summary, "utf8"), /GhostClick theme check/);
  assert.match(readFileSync(outputs, "utf8"), /result<<GHOSTCLICK_EOF\nfailed/);
});
