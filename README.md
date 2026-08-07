# Fixture Lens

This workspace contains private source snapshots and refresh tooling. Do not deploy its root directory or make this repository public.

Create the deployable static site with `node scripts/build-public.mjs`, then preview it with `node scripts/serve-public.mjs` and open [http://localhost:8080](http://localhost:8080). Deploy only the generated `public/` folder. Fixture Ratings is available at `/`; Player Predictions is at `/predictions.html`.

Before releasing, run `node scripts/validate-public.mjs`. The public bundle deliberately contains only the values required to render the site and must not contain provider attribution, source URLs, credentials, or private inputs beyond the team-adjustment rates shown to the browser.

Before deployment, verify that every upstream data provider permits this public use and that no attribution is required. Do not deploy a concealed-source release when the applicable terms require attribution or prohibit redistribution.

## Refresh the bundled snapshot

Run `node scripts/build-data.mjs`. The script downloads the current FPL fixture schedule plus 2025–26 Premier League and Championship results, validates the complete fixture list, and writes `data/fdr-data.json`.

Run `node scripts/validate-data.mjs` to verify the generated data contract and rating bounds.

## Player prediction snapshot

The Predictions page reads `data/ffh_players_compact.json`, a bundled Fantasy Football Hub snapshot covering GW1–10, plus official FPL display names from `data/fpl-player-display-names.json`. Refresh the snapshot with an authenticated Hub session or token using `python fetch_predicted_points.py --output data/ffh_players_compact.json`, then run `node scripts/build-player-display-names.mjs`; credentials are supplied at runtime and are never stored in the snapshot.

Attack difficulty combines the selected team’s goals scored and the opponent’s goals conceded at their corresponding fixture venues; lower attacking opportunity is harder. Defence difficulty combines the selected team’s goals conceded and the opponent’s goals scored at their corresponding fixture venues; lower combined threat is easier. Overall is their equal-weight average. The 1–10 scale is relative to all fixture comparisons. Coventry City uses West Ham’s 2025–26 Premier League rates, Ipswich Town uses Wolves’, and Hull City uses Burnley’s.

In Attack view, the displayed cell number is the selected team’s expected goals: its venue-specific scoring rate averaged with the opponent’s venue-specific conceding rate. In Defence view, it is the opponent’s expected goals: the selected team’s conceding rate averaged with the opponent’s scoring rate. The fixture colour always uses the 1–10 FDR score; Overall displays that FDR number directly.
