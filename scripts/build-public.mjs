import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildLineupSnapshot } from '../lineup-model.js';
import { loadFplReviewWorkbook, mergePredictionSources } from './fplreview-predictions.mjs';

const root = process.cwd();
const args = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--') || index + 1 >= process.argv.length) throw new Error(`Invalid argument: ${key}`);
  args[key.slice(2)] = process.argv[++index];
}
const output = resolve(args.output || join(root, 'public'));
if (output === resolve(root)) throw new Error('Public output directory cannot be the repository root.');
const assets = join(output, 'assets');
const readJson = async (file) => JSON.parse(await readFile(resolve(file), 'utf8'));

function displayNameFor(fullName, names) {
  if (names[fullName]) return names[fullName];
  const parts = fullName.trim().split(/\s+/);
  return parts.length < 3 ? fullName : parts.slice(0, 2).join(' ');
}

function optionalNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}

function sanitizeFixtures(snapshot, nextGameweek) {
  return {
    gameweeks: snapshot.gameweeks,
    nextGameweek: Number(nextGameweek),
    teams: snapshot.teams.map(({ id, name, stats }) => ({
      id,
      name,
      stats: {
        home: { scored: stats.home.scored, conceded: stats.home.conceded },
        away: { scored: stats.away.scored, conceded: stats.away.conceded },
      },
    })),
    fixtures: snapshot.fixtures.map(({ teamId, gameweek, opponentId, opponentName, opponentShort, venue, ratings, averages }) => ({
      teamId, gameweek, opponentId, opponentName, opponentShort, venue,
      ratings: { attack: ratings.attack, defence: ratings.defence, overall: ratings.overall },
      averages: { attack: averages.attack, defence: averages.defence },
    })),
  };
}

function sanitizePlayers(snapshot, nameSnapshot, fixtureSnapshot) {
  const names = nameSnapshot.names || {};
  const matches = nameSnapshot.matches || {};
  return {
    season: fixtureSnapshot.meta.fixtureSeason,
    gameweeks: { min: snapshot.gameweeks.min, max: snapshot.gameweeks.max },
    nextGameweek: Number(nameSnapshot.nextGameweek),
    players: snapshot.players.map((player) => {
      const match = matches[player.fullName];
      if (!match) throw new Error(`Missing official FPL match for ${player.fullName}. Run build-player-display-names.mjs.`);
      const ownership = Number(player.ownership || 0);
      const eliteOwnership = player.eliteOwnership === null || player.eliteOwnership === undefined ? null : Number(Number(player.eliteOwnership).toFixed(1));
      return {
        id: Number(match.id),
        fullName: player.fullName,
        displayName: match.displayName || displayNameFor(player.fullName, names),
        position: player.position,
        team: { id: Number(match.teamId), fullName: player.team.fullName },
        price: Number(player.price),
        ownership,
        eliteOwnership,
        eliteSelectionDifference: eliteOwnership === null ? null : Number((eliteOwnership - ownership).toFixed(1)),
        fixtures: player.fixtures.map((fixture) => ({
          gameweek: fixture.gameweek,
          points: Number(Number(fixture.predictions?.points || 0).toFixed(1)),
          minutes: optionalNumber(fixture.predictions?.minutes) === null ? null : Number(optionalNumber(fixture.predictions.minutes).toFixed(1)),
          opponentName: fixture.opponent?.fullName || fixture.opponent?.shortName || '',
          opponentShort: fixture.opponent?.shortName || '',
          venue: fixture.isHome ? 'H' : 'A',
        })),
      };
    }),
  };
}

await rm(output, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
for (const file of ['index.html', 'predictions.html', 'prediction-lineup.html', 'my-team.html', 'styles.css', 'app.js', 'predictions.js', 'prediction-lineup.js', 'lineup-model.js', 'my-team.js', 'my-team-model.js']) {
  await cp(join(root, file), join(output, file));
}
const [fixtures, ffhPlayers, names, lineupReview, fplReview] = await Promise.all([
  readJson(args['fixture-input'] || 'data/fdr-data.json'),
  readJson(args['prediction-input'] || 'data/ffh_players_compact.json'),
  readJson(args['name-map-input'] || 'data/fpl-player-display-names.json'),
  readJson(args['lineup-input'] || 'data/predicted-lineups.json'),
  loadFplReviewWorkbook(args['fplreview-input'] || 'pred.xlsx'),
]);
const { snapshot: players, coverage } = mergePredictionSources(ffhPlayers, names, fplReview);
const lineups = buildLineupSnapshot(fixtures, players, names, lineupReview);
await Promise.all([
  writeFile(join(assets, 'fixtures.json'), `${JSON.stringify(sanitizeFixtures(fixtures, names.nextGameweek))}\n`),
  writeFile(join(assets, 'players.json'), `${JSON.stringify(sanitizePlayers(players, names, fixtures))}\n`),
  writeFile(join(assets, 'lineups.json'), `${JSON.stringify(lineups)}\n`),
]);
console.log(`Created static release bundle: ${output} (${coverage.blendedFixtures} blended fixtures, ${coverage.fallbackFixtures} FFH fallbacks).`);
