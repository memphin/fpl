import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const args = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--') || index + 1 >= process.argv.length) throw new Error(`Invalid argument: ${key}`);
  args[key.slice(2)] = process.argv[++index];
}
const root = resolve(args['public-dir'] || join(process.cwd(), 'public'));
const allowed = new Set(['app.js', 'index.html', 'predictions.html', 'predictions.js', 'my-team.html', 'my-team.js', 'my-team-model.js', 'styles.css', 'assets/fixtures.json', 'assets/players.json']);
const forbidden = [
  'fantasyfootballhub', 'fantasy.premierleague', 'football-data.co.uk',
  'bootstrap-static', 'api/fixtures', 'stats.source', '"source"', '"fetchedAt"',
  '"minutes"', '"goals"', '"assists"', '"cleanSheets"', '"returns"',
];
const fail = (message) => { throw new Error(message); };

async function filesAt(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = join(directory, entry.name);
    return entry.isDirectory() ? filesAt(full) : [full];
  }));
  return files.flat();
}

const files = await filesAt(root);
const relativeFiles = files.map((file) => relative(root, file).replaceAll('\\', '/')).sort();
if (relativeFiles.length !== allowed.size || relativeFiles.some((file) => !allowed.has(file))) fail(`Unexpected public files: ${relativeFiles.join(', ')}`);
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const matched = forbidden.find((value) => text.toLowerCase().includes(value.toLowerCase()));
  if (matched) fail(`${relative(root, file)} contains forbidden text: ${matched}`);
}

const [privateFixtures, privatePlayers, playerMatches, publicFixtures, publicPlayers] = await Promise.all([
  JSON.parse(await readFile(resolve(args['fixture-input'] || 'data/fdr-data.json'), 'utf8')),
  JSON.parse(await readFile(resolve(args['prediction-input'] || 'data/ffh_players_compact.json'), 'utf8')),
  JSON.parse(await readFile(resolve(args['name-map-input'] || 'data/fpl-player-display-names.json'), 'utf8')),
  JSON.parse(await readFile(join(root, 'assets/fixtures.json'), 'utf8')),
  JSON.parse(await readFile(join(root, 'assets/players.json'), 'utf8')),
]);
if (publicFixtures.teams.length !== privateFixtures.teams.length || publicFixtures.fixtures.length !== privateFixtures.fixtures.length) fail('Fixture release counts do not match private snapshot.');
if (JSON.stringify(publicFixtures.gameweeks) !== JSON.stringify(privateFixtures.gameweeks)) fail('Fixture gameweeks do not match private snapshot.');
if (publicPlayers.players.length !== privatePlayers.players.length) fail('Player release counts do not match private snapshot.');
if (publicPlayers.gameweeks.min !== privatePlayers.gameweeks.min || publicPlayers.gameweeks.max !== privatePlayers.gameweeks.max) fail('Player gameweeks do not match private snapshot.');
if (publicPlayers.season !== privateFixtures.meta.fixtureSeason) fail('Public player season does not match the fixture snapshot.');
if (!Number.isInteger(publicPlayers.nextGameweek)) fail('Public next gameweek is invalid.');
const publicPlayerIds = new Set();
for (const player of publicPlayers.players) {
  const privatePlayer = privatePlayers.players.find((candidate) => candidate.fullName === player.fullName);
  const officialMatch = playerMatches.matches?.[player.fullName];
  if (!privatePlayer || player.fixtures.length !== privatePlayer.fixtures.length) fail(`Player fixture mismatch for ${player.fullName}.`);
  if (!Number.isInteger(player.id) || player.id <= 0 || publicPlayerIds.has(player.id)) fail(`Player ID is missing or duplicated for ${player.fullName}.`);
  publicPlayerIds.add(player.id);
  if (!officialMatch || player.id !== Number(officialMatch.id) || player.team.id !== Number(officialMatch.teamId)) fail(`Official player identity mismatch for ${player.fullName}.`);
  if (!['GK', 'DEF', 'MID', 'FWD'].includes(player.position)) fail(`Invalid position for ${player.fullName}.`);
  if (!Number.isFinite(player.price) || player.price <= 0 || !Number.isInteger(player.team.id) || !player.team.fullName) fail(`Invalid public metadata for ${player.fullName}.`);
  for (const fixture of player.fixtures) {
    const privateFixture = privatePlayer.fixtures.find((candidate) => candidate.gameweek === fixture.gameweek);
    if (!privateFixture || !Number.isFinite(fixture.points) || fixture.points.toFixed(1) !== Number(privateFixture.predictions.points || 0).toFixed(1)) fail(`Displayed points mismatch for ${player.fullName}, GW ${fixture.gameweek}.`);
  }
}
for (const path of ['README.md', 'scripts/build-data.mjs', 'fetch_predicted_points.py', 'data/fdr-data.json', 'data/ffh_players_compact.json']) {
  try { await stat(join(root, path)); fail(`Private file was published: ${path}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log(`Validated ${relativeFiles.length} public files, ${publicFixtures.fixtures.length} fixtures, and ${publicPlayers.players.length} players.`);
