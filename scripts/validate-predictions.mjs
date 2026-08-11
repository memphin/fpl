import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validatePredictionSnapshot } from './prediction-refresh-lib.mjs';
import { loadFplReviewWorkbook, mergePredictionSources } from './fplreview-predictions.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length) throw new Error(`Invalid argument: ${key}`);
    values[key.slice(2)] = argv[++index];
  }
  return values;
}

const args = parseArgs(process.argv.slice(2));
const inputPath = resolve(args.input || 'data/ffh_players_compact.json');
const nameMapPath = args['name-map-input'] ? resolve(args['name-map-input']) : null;
const snapshot = JSON.parse(await readFile(inputPath, 'utf8'));
const nameSnapshot = nameMapPath ? JSON.parse(await readFile(nameMapPath, 'utf8')) : null;
const fplReview = await loadFplReviewWorkbook(args['fplreview-input'] || 'pred.xlsx');
const result = validatePredictionSnapshot(snapshot, {
  minGameweek: args['min-gameweek'] === undefined ? snapshot.gameweeks?.min : Number(args['min-gameweek']),
  maxGameweek: args['max-gameweek'] === undefined ? snapshot.gameweeks?.max : Number(args['max-gameweek']),
  maxAgeMinutes: Number(args['max-age-minutes'] || 0),
  minimumPlayerCount: args['minimum-player-count'] === undefined ? 300 : Number(args['minimum-player-count']),
  nameSnapshot,
});

const coverage = nameSnapshot ? mergePredictionSources(snapshot, nameSnapshot, fplReview).coverage : null;
console.log(`Validated ${result.playerCount} FFH players fetched at ${result.fetchedAt} and ${fplReview.count} FPL Review players${coverage ? ` (${coverage.blendedFixtures} blended fixtures, ${coverage.fallbackFixtures} FFH fallbacks)` : ''}.`);
