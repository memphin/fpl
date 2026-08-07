# Fixture Lens

Start the local server with `node scripts/serve.mjs`, then open [http://localhost:8080](http://localhost:8080). It does not make runtime network requests: the browser reads only `data/fdr-data.json`.

## Refresh the bundled snapshot

Run `node scripts/build-data.mjs`. The script downloads the current FPL fixture schedule plus 2025–26 Premier League and Championship results, validates the complete fixture list, and writes `data/fdr-data.json`.

Run `node scripts/validate-data.mjs` to verify the generated data contract and rating bounds.

Attack difficulty combines the selected team’s goals scored and the opponent’s goals conceded at their corresponding fixture venues; lower attacking opportunity is harder. Defence difficulty combines the selected team’s goals conceded and the opponent’s goals scored at their corresponding fixture venues; lower combined threat is easier. Overall is their equal-weight average. The 1–10 scale is relative to all fixture comparisons. Coventry City uses West Ham’s 2025–26 Premier League rates, Ipswich Town uses Wolves’, and Hull City uses Burnley’s.

In Attack view, the displayed cell number is the selected team’s expected goals: its venue-specific scoring rate averaged with the opponent’s venue-specific conceding rate. In Defence view, it is the opponent’s expected goals: the selected team’s conceding rate averaged with the opponent’s scoring rate. The fixture colour always uses the 1–10 FDR score; Overall displays that FDR number directly.
