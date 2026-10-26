# GhostClick theme check

Run your GhostClick journeys against a Shopify theme before it goes live, and fail the pull request when a shopper can no longer get through. It works like Shopify's Lighthouse CI action: the Action pushes your theme to a hidden development theme, GhostClick walks your saved journeys on that preview, and the results land in the job summary and on the pull request.

What it checks:

- **Journeys.** The journeys you picked for your GitHub key in GhostClick. Each one replays its recorded path on the preview theme with no AI, on the devices the journey runs on. If a recorded step no longer works, the AI agent tries the journey from scratch on the same preview, so a moved button is not a false alarm but a real dead end is.
- **Page monitors.** Links, images, SEO and forms on each page monitor you picked, with a 0 to 100 score. They do not use audits from your allowance.

Nothing a CI check finds touches your live monitoring: no alerts, no change to the journey's history, trend or recording.

Each check in the pull request links to its report. With "Report links anyone can open" on (the default), developers can open it without a GhostClick login. The link is unlisted and hidden from search engines, and store passwords and codes are masked, but anyone who can see the pull request can open it, so turn it off for a public repository.

## Before you start

1. **A GhostClick plan with theme checks** (Growth and up) and at least one saved journey on the store.
2. **A GitHub key.** In GhostClick, open Settings, GitHub Action, pick the store and the journeys and pages the key may run, and make the key. Save it as the repository secret `GHOSTCLICK_TOKEN`. The key is locked to that store and those checks: it cannot start any other audit or read your account, and the workflow cannot change what it runs. Revoke it in the same place.
3. **A Theme Access password** so the Action can push the theme. Install Shopify's [Theme Access](https://apps.shopify.com/theme-access) app, create a password for your store, and save it as `SHOPIFY_THEME_ACCESS_PASSWORD`. (Skip this if your workflow already pushes the theme and you pass `theme_id`.)
4. Save your store's address, like `my-store.myshopify.com`, as `SHOP_STORE`.

## Usage

```yaml
# .github/workflows/ghostclick.yml
name: GhostClick theme check
on: [pull_request]

permissions:
  contents: read
  pull-requests: write # only for the pull request comment

jobs:
  ghostclick:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: ghostclickhq/theme-check-action@v1
        with:
          ghostclick_token: ${{ secrets.GHOSTCLICK_TOKEN }}
          store: ${{ secrets.SHOP_STORE }}
          theme_access_password: ${{ secrets.SHOPIFY_THEME_ACCESS_PASSWORD }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          min_page_score: 80
```

Already pushing the theme yourself (for example with `shopify theme push --unpublished --json`)? Pass its id instead and the Action only runs the checks:

```yaml
      - uses: ghostclickhq/theme-check-action@v1
        with:
          ghostclick_token: ${{ secrets.GHOSTCLICK_TOKEN }}
          store: ${{ secrets.SHOP_STORE }}
          theme_id: ${{ steps.push.outputs.theme_id }}
```

## Inputs

| Input | Default | What it does |
|---|---|---|
| `ghostclick_token` | required | Your GhostClick GitHub key. It decides the store and the checks. |
| `store` | required | Your `.myshopify.com` address. |
| `theme_id` | | A theme you already pushed. Empty: the Action pushes `theme_root` to a development theme and deletes it at the end. |
| `theme_access_password` | | Theme Access password, needed when `theme_id` is empty. |
| `theme_root` | `.` | The folder with the theme files. |
| `min_page_score` | `0` | Fail when a page scores under this. `0` fails only on critical issues. |
| `fail_on_failure` | `true` | `false` reports without failing the workflow. |
| `timeout_minutes` | `30` | How long to wait for the results. |
| `github_token` | | Pass `secrets.GITHUB_TOKEN` for a pull request comment that updates on every push. |

Outputs: `result` (`passed` or `failed`), `theme_id`, `report_urls`.

## Good to know

- **Allowance.** Each journey checked uses one audit from your monthly allowance, like running it yourself. Page monitors are free. When the allowance runs out, the journeys that could not run are listed and the check fails, so nothing passes silently.
- **Time.** A replay takes about a minute. Checks queue behind your other GhostClick runs, so a busy account can take longer.
- **Password-protected stores.** GhostClick uses the store password saved with each journey.
- **Theme settings.** The development theme gets the settings and templates in your repository. If your repository does not hold `config/settings_data.json` and the JSON templates, the preview looks like the theme's defaults.
- **Matchups** compare another site, so they never run in CI.
- **Changing what runs** means making a new key in GhostClick and updating the secret. A journey you delete drops out of the key and the Action says so.

## Developing this Action

`node --test *.test.mjs` runs the tests (from the Action's own folder). The Action calls `POST /api/ci/theme-checks` and `GET /api/ci/theme-checks?ids=`. Its source lives in `github-action/` in the GhostClick app repository and is published from there to `ghostclickhq/theme-check-action`.
