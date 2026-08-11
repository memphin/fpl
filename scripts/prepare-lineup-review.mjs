import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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

const readJson = async (path) => JSON.parse(await readFile(resolve(path), 'utf8'));
const args = parseArgs(process.argv.slice(2));
const [fixtures, ffhPlayers, names, fplReview] = await Promise.all([
  readJson(args['fixture-input'] || 'data/fdr-data.json'),
  readJson(args['prediction-input'] || 'data/ffh_players_compact.json'),
  readJson(args['name-map-input'] || 'data/fpl-player-display-names.json'),
  loadFplReviewWorkbook(args['fplreview-input'] || 'pred.xlsx'),
]);
const { snapshot: players } = mergePredictionSources(ffhPlayers, names, fplReview);
let previous = null;
try { previous = await readJson(args['lineup-input'] || 'data/predicted-lineups.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const snapshot = buildLineupSnapshot(fixtures, players, names, previous);
const rawById = new Map(players.players.map((player) => {
  const identity = names.matches[player.fullName];
  const fixture = player.fixtures.find((item) => Number(item.gameweek) === snapshot.gameweek);
  return [Number(identity.id), { price: player.price, projectedMinutes: fixture?.predictions?.minutes ?? null, predictedPoints: fixture?.predictions?.points ?? null, status: player.status }];
}));
const previousByTeam = new Map((previous?.teams || []).map((team) => [Number(team.teamId), team]));
const teams = snapshot.fixtures.flatMap((fixture) => fixture.teams).sort((left, right) => left.teamName.localeCompare(right.teamName)).map((team) => {
  const prior = previousByTeam.get(team.teamId);
  const decorate = (player) => ({
    playerId: player.playerId,
    playerName: player.displayName,
    ...(player.slot ? { slot: player.slot } : { targetSlot: player.targetSlot }),
    price: rawById.get(player.playerId)?.price ?? null,
    projectedMinutes: rawById.get(player.playerId)?.projectedMinutes ?? null,
    predictedPoints: rawById.get(player.playerId)?.predictedPoints ?? null,
    status: rawById.get(player.playerId)?.status ?? null,
  });
  return {
    teamId: team.teamId,
    teamName: team.teamName,
    formation: team.formation,
    starters: team.starters.map(decorate),
    contenders: team.contenders.map(decorate),
    reviewedAt: prior?.reviewedAt || null,
    sources: prior?.sources || [],
  };
});
const draft = { season: snapshot.season, gameweek: snapshot.gameweek, instructions: 'Review formation and slots, then set reviewedAt and at least one source per team. playerName, price, projectedMinutes, predictedPoints and status are advisory.', teams };
const output = resolve(args.output || `work/lineup-review-gw${snapshot.gameweek}.json`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(draft, null, 2)}\n`);
console.log(`Prepared ${teams.length}-team lineup review draft: ${output}`);
