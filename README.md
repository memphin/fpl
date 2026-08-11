# Fixture Lens

This workspace contains private source snapshots and refresh tooling. Do not deploy its root directory or make this repository public.

Create the deployable static site with `node scripts/build-public.mjs`, then preview it with `node scripts/serve-public.mjs` and open [http://localhost:8080](http://localhost:8080). Deploy only the generated `public/` folder. Player Predictions is available at `/`; Prediction Lineups is at `/prediction-lineup.html`; Fixture Ratings is at `/fixture-ratings.html`.

Before releasing, run `node scripts/validate-public.mjs`. The public bundle deliberately contains only the values required to render the site and must not contain provider attribution, source URLs, credentials, or private inputs beyond the team-adjustment rates shown to the browser.

Before deployment, verify that every upstream data provider permits this public use and that no attribution is required. Do not deploy a concealed-source release when the applicable terms require attribution or prohibit redistribution.

## Refresh the bundled snapshot

Run `node scripts/build-data.mjs`. The script downloads the current FPL fixture schedule plus 2025–26 Premier League and Championship results, validates the complete fixture list, and writes `data/fdr-data.json`.

Run `node scripts/validate-data.mjs` to verify the generated data contract and rating bounds.

## Player prediction snapshots

The Predictions page blends `data/ffh_players_compact.json` with the `pred` worksheet in the private `pred.xlsx` FPL Review export. Players are matched by official FPL ID through `data/fpl-player-display-names.json`. Each covered player-gameweek publishes the equal-weight average of both point projections, while expected minutes and elite ownership come from `pred.xlsx`. If the workbook does not contain a player or exact gameweek, the build falls back to Fantasy Football Hub points and minutes; elite ownership is unavailable for an unmatched player.

Replace `pred.xlsx` manually whenever a newer FPL Review export is available. Its `pred` sheet must contain unique `ID` values, `Pos`, `Name`, `Team`, `Elite%`, and paired `<GW>_xMins` / `<GW>_Pts` columns. The separate root `pred.csv` is ignored and not used. The workbook parser rejects malformed IDs, column pairs, points, minutes outside 0–95, and elite percentages outside 0–100.

The public bundle contains only blended points, the expected minutes required by the Predictions page, elite ownership metrics, and the existing derived lineup confidence. It never includes either private snapshot, provider names, source URLs, or raw lineup research.

For a one-off refresh of the tracked development snapshot, run:

```powershell
$env:FFH_TOKEN = 'provider-issued-long-lived-token'
python fetch_predicted_points.py --output data/ffh_players_compact.json
node scripts/build-player-display-names.mjs
npm run build
npm run validate
```

## Prediction deployment

`.github/workflows/refresh-predictions.yml` deploys every push to `main` using the committed FFH snapshot and `pred.xlsx`, so application and workbook changes reach GitHub Pages and Cloudflare Pages without requiring a live provider login. It also runs every day at 05:17 in the `Europe/Zagreb` timezone and can be started manually from the Actions page; those runs fetch current Hub predictions, blend the matching gameweeks from the committed `pred.xlsx`, validate a source-opaque `public/` bundle, and deploy it to both hosts. Live refreshes never commit the downloaded Hub snapshot. Their workflow summary reports matched Review players, blended player-gameweeks, and FFH fallbacks so stale workbook coverage is visible.

One-time GitHub setup:

1. Enable GitHub Actions for the repository.
2. In **Settings → Pages**, select **GitHub Actions** as the publishing source.
3. Add a repository Actions secret named `FFH_TOKEN` containing a provider-issued bearer token that is valid for unattended recurring access.
4. Restrict the `github-pages` environment to deployments from the default branch.
5. Add the Cloudflare repository secret `CLOUDFLARE_API_TOKEN` with account-level **Cloudflare Pages: Edit** permission.
6. Add repository variables `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_PAGES_PROJECT`.
7. In the Cloudflare Pages project, disable automatic production and preview branch deployments so a Git build cannot overwrite the directly uploaded refreshed bundle with tracked development fixtures.
8. Run **Prediction release** manually and verify both deployed URLs before relying on the schedule.

Rotate the provider credential by replacing the `FFH_TOKEN` repository secret; no source change is required. An invalid FFH token blocks only scheduled and manual live refreshes, not push deployments of committed data. Rotate Cloudflare deployment access by replacing `CLOUDFLARE_API_TOKEN` with another Pages-only token. Tokens are passed only through process inputs or environments. Temporary private snapshots are deleted at the end of the job and are never uploaded as artifacts.

Run the same staged pipeline locally with `npm run refresh:predictions`. It writes only the ignored `public/` directory and leaves tracked `data/` files unchanged. Missing or rejected credentials, incomplete data, player-identity mismatches, test failures, or public-bundle validation failures stop the workflow before artifact upload, leaving the previous Pages deployment live. When the season has no next gameweek, the workflow succeeds without deploying.

The workflow summary records only the requested gameweek range, fetch time, player count, validation result, and deployment URLs. GitHub's normal failed-workflow notification is the operational alert; inspect the Actions log, correct or rotate the relevant secret when necessary, and rerun the workflow manually.

## Predicted lineup review

`data/predicted-lineups.json` is the private, editor-reviewed lineup input. It stores exact tactical slots and research URLs; the public bundle receives only the optimized XI, three contenders, player prices, source count, review status, and minutes-based nailed estimate. Compatible players with higher nailed estimates are promoted into the starting XI within the reviewed formation. Generate a review-friendly draft with `npm run prepare:lineups`, update the tracked input, then run `npm run validate:lineups` before building. If the tracked review does not match the official next gameweek, all 20 teams are generated as clearly labeled automatic estimates. If a reviewed starter or contender has left the team, only that team's review falls back to an automatic estimate in its reviewed formation; structurally malformed reviews still fail validation.

Attack difficulty combines the selected team’s goals scored and the opponent’s goals conceded at their corresponding fixture venues; lower attacking opportunity is harder. Defence difficulty combines the selected team’s goals conceded and the opponent’s goals scored at their corresponding fixture venues; lower combined threat is easier. Overall is their equal-weight average. The 1–10 scale is relative to all fixture comparisons. Coventry City uses West Ham’s 2025–26 Premier League rates, Ipswich Town uses Wolves’, and Hull City uses Burnley’s.

In Attack view, the displayed cell number is the selected team’s expected goals: its venue-specific scoring rate averaged with the opponent’s venue-specific conceding rate. In Defence view, it is the opponent’s expected goals: the selected team’s conceding rate averaged with the opponent’s scoring rate. The fixture colour always uses the 1–10 FDR score; Overall displays that FDR number directly.
