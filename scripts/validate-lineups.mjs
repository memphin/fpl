import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildLineupSnapshot } from '../lineup-model.js';
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
const readJson = async (path) => JSON.parse(await readFile(resolve(path), 'utf8'));
const [fixtures, ffhPlayers, names, review, fplReview] = await Promise.all([
  readJson(args['fixture-input'] || 'data/fdr-data.json'),
  readJson(args['prediction-input'] || 'data/ffh_players_compact.json'),
  readJson(args['name-map-input'] || 'data/fpl-player-display-names.json'),
  readJson(args.input || 'data/predicted-lineups.json'),
  loadFplReviewWorkbook(args['fplreview-input'] || 'pred.xlsx'),
]);
const { snapshot: players } = mergePredictionSources(ffhPlayers, names, fplReview);
const output = buildLineupSnapshot(fixtures, players, names, review);
const teams = output.fixtures.flatMap((fixture) => fixture.teams);
const reviewed = teams.filter((team) => team.predictionStatus === 'reviewed').length;
console.log(`Validated GW ${output.gameweek} lineups: ${reviewed} reviewed, ${teams.length - reviewed} automatic.`);
