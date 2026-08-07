import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const output = join(root, 'public');
const assets = join(output, 'assets');
const readJson = async (file) => JSON.parse(await readFile(join(root, file), 'utf8'));

function displayNameFor(fullName, names) {
  if (names[fullName]) return names[fullName];
  const parts = fullName.trim().split(/\s+/);
  return parts.length < 3 ? fullName : parts.slice(0, 2).join(' ');
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

function sanitizePlayers(snapshot, nameSnapshot) {
  const names = nameSnapshot.names || {};
  return {
    gameweeks: { min: snapshot.gameweeks.min, max: snapshot.gameweeks.max },
    nextGameweek: Number(nameSnapshot.nextGameweek),
    players: snapshot.players.map((player) => ({
      fullName: player.fullName,
      displayName: displayNameFor(player.fullName, names),
      position: player.position,
      team: { fullName: player.team.fullName },
      price: Number(player.price),
      ownership: Number(player.ownership || 0),
      fixtures: player.fixtures.map((fixture) => ({
        gameweek: fixture.gameweek,
        points: Number(fixture.predictions?.points || 0).toFixed(1),
      })),
    })),
  };
}

await rm(output, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
for (const file of ['index.html', 'predictions.html', 'styles.css', 'app.js', 'predictions.js']) {
  await cp(join(root, file), join(output, file));
}
const [fixtures, players, names] = await Promise.all([
  readJson('data/fdr-data.json'),
  readJson('data/ffh_players_compact.json'),
  readJson('data/fpl-player-display-names.json'),
]);
await Promise.all([
  writeFile(join(assets, 'fixtures.json'), `${JSON.stringify(sanitizeFixtures(fixtures, names.nextGameweek))}\n`),
  writeFile(join(assets, 'players.json'), `${JSON.stringify(sanitizePlayers(players, names))}\n`),
]);
console.log(`Created static release bundle: ${output}`);
