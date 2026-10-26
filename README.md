# GhostClick theme check

Check a Shopify theme before it goes live. Give it the theme's preview link, GhostClick walks your saved journeys and checks your pages on that preview, and the step passes or fails with a short message and a link to each report. It does not push, change or delete any theme: getting the theme onto the store stays your team's job, however you already do it.

What it checks:

- **Journeys.** The journeys you picked for your key in GhostClick. Each one replays its recorded path on the preview with no AI, on the devices the journey runs on. If a recorded step no longer works, the AI agent tries the journey from scratch on the same preview, so a moved button is not a false alarm but a real dead end is.
- **Page monitors.** Links, images, SEO and forms on each page monitor you picked, with a 0 to 100 score. They do not use audits from your allowance.

Nothing a check finds touches your live monitoring: no alerts, no change to the journey's history, trend or recording.

## Before you start

1. **A GhostClick plan with theme checks** (Growth and up) and at least one saved journey on the store.
2. **A key.** In GhostClick, open Settings, GitHub Action, pick the store and the journeys and pages the key may run, and make the key. Save it as the secret `GHOSTCLICK_TOKEN`. The key is locked to that store and those checks: it cannot start any other audit or read your account. Revoke it in the same place.
3. **The theme's preview link.** In Shopify, open Online Store, Themes, then Preview on the theme (or copy its share link). Any link with `?preview_theme_id=` in it works, as does a theme editor link or the theme id on its own.

## GitHub Actions

```yaml
# .github/workflows/ghostclick.yml
name: GhostClick theme check
on:
  workflow_dispatch:
    inputs:
      preview_url:
        description: Theme preview link
        required: true
  pull_request:

permissions:
  contents: read
  pull-requests: write # only for the pull request comment

jobs:
  ghostclick:
    runs-on: ubuntu-latest
    steps:
      - uses: ghostclickhq/theme-check-action@v2
        with:
          ghostclick_token: ${{ secrets.GHOSTCLICK_TOKEN }}
          preview_url: ${{ inputs.preview_url || vars.GHOSTCLICK_PREVIEW_URL }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

On a pull request it checks the theme in the repository variable `GHOSTCLICK_PREVIEW_URL` (for example the theme your branch deploys to). From the Actions tab, "Run workflow" checks any preview link you paste.

Already deploying the theme in an earlier step? Pass its id from that step:

```yaml
      - uses: ghostclickhq/theme-check-action@v2
        with:
          ghostclick_token: ${{ secrets.GHOSTCLICK_TOKEN }}
          theme_id: ${{ steps.deploy.outputs.theme_id }}
```

## Any other build (GitLab, Bitbucket, CircleCI, a deploy script)

The check is one Node 18+ script with no dependencies. Set two environment variables and run it. It exits 0 when every check passed and 1 when something broke, with one line per failure and its report link.

```sh
curl -fsSL https://raw.githubusercontent.com/ghostclickhq/theme-check-action/v2/ghostclick-check.mjs -o ghostclick-check.mjs
GHOSTCLICK_TOKEN="$GHOSTCLICK_TOKEN" \
GHOSTCLICK_PREVIEW_URL="https://my-store.myshopify.com/?preview_theme_id=123456789" \
node ghostclick-check.mjs
```

Optional variables: `GHOSTCLICK_THEME_ID`, `GHOSTCLICK_MIN_PAGE_SCORE`, `GHOSTCLICK_FAIL_ON_FAILURE`, `GHOSTCLICK_TIMEOUT_MINUTES`.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `ghostclick_token` | required | Your GhostClick key. It decides the store and the checks. |
| `preview_url` | | The theme's preview link. |
| `theme_id` | | The theme's id, instead of `preview_url`. |
| `store` | | Optional `.myshopify.com` address, checked against the key. |
| `min_page_score` | `0` | Fail when a page scores under this. `0` fails only on critical issues. |
| `fail_on_failure` | `true` | `false` reports without failing the step. |
| `timeout_minutes` | `30` | How long to wait for the results. |
| `github_token` | | Pass `secrets.GITHUB_TOKEN` for a pull request comment that updates on every run. |

Outputs: `result` (`passed` or `failed`), `theme_id`, `report_urls`.

## Good to know

- **Report links.** With "Report links anyone can open" on (the default for a key), developers can open each report without a GhostClick login. The link is unlisted and hidden from search engines, and store passwords and codes are masked, but anyone who sees the build log can open it, so turn it off for a public repository.
- **Allowance.** Each journey checked uses one audit from your monthly allowance, like running it yourself. Page monitors are free. When the allowance runs out, the journeys that could not run are listed and the check fails, so nothing passes silently.
- **Time.** A replay takes about a minute. Checks queue behind your other GhostClick runs, so a busy account can take longer.
- **Password-protected stores.** GhostClick uses the store password saved with each journey.
- **The theme must be on the key's store.** GhostClick checks the id against the store first, because Shopify quietly shows the live theme for an id it does not know.
- **Matchups** compare another site, so they never run here.
- **Changing what runs** means making a new key in GhostClick and updating the secret. A journey you delete drops out of the key and the check says so.

## Developing this Action

`node --test *.test.mjs` runs the tests (from the Action's own folder). The script calls `POST /api/ci/theme-checks` and `GET /api/ci/theme-checks?ids=`. Its source lives in `github-action/` in the GhostClick app repository and is published from there to `ghostclickhq/theme-check-action`.
