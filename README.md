# Fixture Lens

This workspace contains private source snapshots and refresh tooling. Do not deploy its root directory or make this repository public.

Create the deployable static site with `node scripts/build-public.mjs`, then preview it with `node scripts/serve-public.mjs` and open [http://localhost:8080](http://localhost:8080). Deploy only the generated `public/` folder. Fixture Ratings is available at `/`; Player Predictions is at `/predictions.html`; Prediction Lineup is at `/prediction-lineup.html`.

Before releasing, run `node scripts/validate-public.mjs`. The public bundle deliberately contains only the values required to render the site and must not contain provider attribution, source URLs, credentials, or private inputs beyond the team-adjustment rates shown to the browser.

Before deployment, verify that every upstream data provider permits this public use and that no attribution is required. Do not deploy a concealed-source release when the applicable terms require attribution or prohibit redistribution.

## Refresh the bundled snapshot

Run `node scripts/build-data.mjs`. The script downloads the current FPL fixture schedule plus 2025–26 Premier League and Championship results, validates the complete fixture list, and writes `data/fdr-data.json`.

Run `node scripts/validate-data.mjs` to verify the generated data contract and rating bounds.

## Player prediction snapshot

The Predictions page is built from `data/ffh_players_compact.json`, a tracked offline Fantasy Football Hub snapshot, plus official FPL identities from `data/fpl-player-display-names.json`. Credentials are supplied at runtime and are never stored in either snapshot or in the public bundle.

For a one-off refresh of the tracked development snapshot, run:

```powershell
$env:FFH_TOKEN = 'provider-issued-long-lived-token'
python fetch_predicted_points.py --output data/ffh_players_compact.json
node scripts/build-player-display-names.mjs
npm run build
npm run validate
```

## Daily prediction deployment

`.github/workflows/refresh-predictions.yml` runs every day at 05:17 in the `Europe/Zagreb` timezone and can also be started manually from the Actions page. Each run determines the official next FPL gameweek, fetches predictions from that gameweek through the following nine gameweeks (capped at GW38), builds a source-opaque `public/` bundle, and deploys that artifact to GitHub Pages. It never commits the refreshed provider snapshot.

One-time GitHub setup:

1. Enable GitHub Actions for the repository.
2. In **Settings → Pages**, select **GitHub Actions** as the publishing source.
3. Add a repository Actions secret named `FFH_TOKEN` containing a provider-issued bearer token that is valid for unattended recurring access.
4. Restrict the `github-pages` environment to deployments from the default branch.
5. Run **Daily predicted-points refresh** manually and verify its summary and deployed URL before relying on the schedule.

Rotate the provider credential by replacing the `FFH_TOKEN` repository secret; no source change is required. The token is passed only through the refresh process environment. Temporary private snapshots are deleted at the end of the job and are never uploaded as artifacts.

Run the same staged pipeline locally with `npm run refresh:predictions`. It writes only the ignored `public/` directory and leaves tracked `data/` files unchanged. Missing or rejected credentials, incomplete data, player-identity mismatches, test failures, or public-bundle validation failures stop the workflow before artifact upload, leaving the previous Pages deployment live. When the season has no next gameweek, the workflow succeeds without deploying.

The workflow summary records only the requested gameweek range, fetch time, player count, validation result, and Pages URL. GitHub's normal failed-workflow notification is the operational alert; inspect the Actions log, correct or rotate the secret when necessary, and rerun the workflow manually.

## Predicted lineup review

`data/predicted-lineups.json` is the private, editor-reviewed lineup input. It stores exact tactical slots and research URLs; the public bundle receives only the optimized XI, three contenders, player prices, source count, review status, and minutes-based nailed estimate. Compatible players with higher nailed estimates are promoted into the starting XI within the reviewed formation. Generate a review-friendly draft with `npm run prepare:lineups`, update the tracked input, then run `npm run validate:lineups` before building. If the tracked review does not match the official next gameweek, all 20 teams are generated as clearly labeled automatic estimates. If a reviewed starter or contender has left the team, only that team's review falls back to an automatic estimate in its reviewed formation; structurally malformed reviews still fail validation.

Attack difficulty combines the selected team’s goals scored and the opponent’s goals conceded at their corresponding fixture venues; lower attacking opportunity is harder. Defence difficulty combines the selected team’s goals conceded and the opponent’s goals scored at their corresponding fixture venues; lower combined threat is easier. Overall is their equal-weight average. The 1–10 scale is relative to all fixture comparisons. Coventry City uses West Ham’s 2025–26 Premier League rates, Ipswich Town uses Wolves’, and Hull City uses Burnley’s.

In Attack view, the displayed cell number is the selected team’s expected goals: its venue-specific scoring rate averaged with the opponent’s venue-specific conceding rate. In Defence view, it is the opponent’s expected goals: the selected team’s conceding rate averaged with the opponent’s scoring rate. The fixture colour always uses the 1–10 FDR score; Overall displays that FDR number directly.
