import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { FORMATIONS } from '../lineup-model.js';
import { loadFplReviewWorkbook, mergePredictionSources } from './fplreview-predictions.mjs';

const args = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--') || index + 1 >= process.argv.length) throw new Error(`Invalid argument: ${key}`);
  args[key.slice(2)] = process.argv[++index];
}
const root = resolve(args['public-dir'] || join(process.cwd(), 'public'));
const allowed = new Set(['app.js', 'index.html', 'predictions.html', 'predictions.js', 'prediction-lineup.html', 'prediction-lineup.js', 'lineup-model.js', 'my-team.html', 'my-team.js', 'my-team-model.js', 'styles.css', 'assets/fixtures.json', 'assets/players.json', 'assets/lineups.json']);
const forbidden = [
  'fantasyfootballhub', 'fplreview', 'fantasy.premierleague', 'football-data.co.uk',
  'bootstrap-static', 'api/fixtures', 'stats.source', '"source"', '"fetchedAt"',
  '"goals"', '"assists"', '"cleanSheets"', '"returns"',
];
const fail = (message) => { throw new Error(message); };
const optionalNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

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

const [privateFixtures, ffhPlayers, playerMatches, fplReview, publicFixtures, publicPlayers, publicLineups] = await Promise.all([
  JSON.parse(await readFile(resolve(args['fixture-input'] || 'data/fdr-data.json'), 'utf8')),
  JSON.parse(await readFile(resolve(args['prediction-input'] || 'data/ffh_players_compact.json'), 'utf8')),
  JSON.parse(await readFile(resolve(args['name-map-input'] || 'data/fpl-player-display-names.json'), 'utf8')),
  loadFplReviewWorkbook(args['fplreview-input'] || 'pred.xlsx'),
  JSON.parse(await readFile(join(root, 'assets/fixtures.json'), 'utf8')),
  JSON.parse(await readFile(join(root, 'assets/players.json'), 'utf8')),
  JSON.parse(await readFile(join(root, 'assets/lineups.json'), 'utf8')),
]);
const { snapshot: privatePlayers } = mergePredictionSources(ffhPlayers, playerMatches, fplReview);
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
  const expectedElite = privatePlayer.eliteOwnership === null ? null : Number(Number(privatePlayer.eliteOwnership).toFixed(1));
  const expectedDifference = expectedElite === null ? null : Number((expectedElite - Number(privatePlayer.ownership || 0)).toFixed(1));
  if (player.eliteOwnership !== expectedElite || player.eliteSelectionDifference !== expectedDifference) fail(`Elite ownership mismatch for ${player.fullName}.`);
  for (const fixture of player.fixtures) {
    const privateFixture = privatePlayer.fixtures.find((candidate) => candidate.gameweek === fixture.gameweek);
    if (!privateFixture || !Number.isFinite(fixture.points) || fixture.points.toFixed(1) !== Number(privateFixture.predictions.points || 0).toFixed(1)) fail(`Displayed points mismatch for ${player.fullName}, GW ${fixture.gameweek}.`);
    const privateMinutes = optionalNumber(privateFixture.predictions.minutes);
    const expectedMinutes = privateMinutes === null ? null : Number(privateMinutes.toFixed(1));
    if (fixture.minutes !== expectedMinutes || (fixture.minutes !== null && (fixture.minutes < 0 || fixture.minutes > 95))) fail(`Displayed minutes mismatch for ${player.fullName}, GW ${fixture.gameweek}.`);
  }
}
if (publicLineups.season !== publicPlayers.season || publicLineups.gameweek !== publicPlayers.nextGameweek || !Number.isFinite(Date.parse(publicLineups.generatedAt))) fail('Public lineup metadata is invalid.');
if (!Array.isArray(publicLineups.fixtures) || publicLineups.fixtures.length !== 10) fail('Public lineup snapshot must contain 10 fixtures.');
const publicPlayerById = new Map(publicPlayers.players.map((player) => [player.id, player]));
const lineupTeamIds = new Set();
for (const fixture of publicLineups.fixtures) {
  if (!Array.isArray(fixture.teams) || fixture.teams.length !== 2 || fixture.teams[0].venue !== 'H' || fixture.teams[1].venue !== 'A') fail('Public lineup fixture has invalid teams or venues.');
  if (fixture.homeTeamId !== fixture.teams[0].teamId || fixture.awayTeamId !== fixture.teams[1].teamId) fail('Public lineup fixture IDs are inconsistent.');
  const officialFixture = publicFixtures.fixtures.find((item) => item.gameweek === publicLineups.gameweek && item.teamId === fixture.homeTeamId && item.opponentId === fixture.awayTeamId && item.venue === 'H');
  if (!officialFixture) fail(`Public lineup fixture ${fixture.homeTeamId}/${fixture.awayTeamId} is not in the fixture snapshot.`);
  for (const team of fixture.teams) {
    if (lineupTeamIds.has(team.teamId)) fail(`Public lineup repeats team ${team.teamId}.`);
    lineupTeamIds.add(team.teamId);
    const slots = FORMATIONS[team.formation];
    if (!slots || !['reviewed', 'automatic'].includes(team.predictionStatus) || !Number.isFinite(Date.parse(team.updatedAt))) fail(`Public lineup metadata is invalid for ${team.teamName}.`);
    if ((team.predictionStatus === 'reviewed' && team.sourceCount < 1) || (team.predictionStatus === 'automatic' && team.sourceCount !== 0)) fail(`Public source count is invalid for ${team.teamName}.`);
    if (!Array.isArray(team.starters) || team.starters.length !== 11 || !Array.isArray(team.contenders) || team.contenders.length > 3) fail(`Public lineup player count is invalid for ${team.teamName}.`);
    const requiredSlots = new Set(slots.map((slot) => slot.key));
    const starterIds = new Set();
    for (const player of team.starters) {
      const identity = publicPlayerById.get(player.playerId);
      if (!identity || identity.team.id !== team.teamId || starterIds.has(player.playerId) || !requiredSlots.delete(player.slot)) fail(`Invalid starter in ${team.teamName} lineup.`);
      starterIds.add(player.playerId);
      if (!Number.isFinite(player.price) || player.price !== identity.price) fail(`Invalid price for ${player.displayName}.`);
      if (player.nailedPercent !== null && (!Number.isInteger(player.nailedPercent) || player.nailedPercent < 0 || player.nailedPercent > 100)) fail(`Invalid nailed percentage for ${player.displayName}.`);
      const minutes = identity.fixtures.find((item) => item.gameweek === publicLineups.gameweek)?.minutes;
      const expectedNailed = minutes === null || minutes === undefined ? null : Math.round((Math.max(0, Math.min(90, minutes)) / 90) * 100);
      if (player.nailedPercent !== expectedNailed) fail(`Lineup minutes mismatch for ${player.displayName}.`);
      if (!['available', 'doubt', 'injured', 'suspended'].includes(player.availability)) fail(`Invalid availability for ${player.displayName}.`);
    }
    if (requiredSlots.size) fail(`${team.teamName} lineup is missing formation slots.`);
    const contenderIds = new Set();
    for (const player of team.contenders) {
      const identity = publicPlayerById.get(player.playerId);
      if (!identity || identity.team.id !== team.teamId || starterIds.has(player.playerId) || contenderIds.has(player.playerId) || !slots.some((slot) => slot.key === player.targetSlot)) fail(`Invalid contender in ${team.teamName} lineup.`);
      if (!Number.isFinite(player.price) || player.price !== identity.price) fail(`Invalid contender price for ${player.displayName}.`);
      contenderIds.add(player.playerId);
    }
  }
}
if (lineupTeamIds.size !== 20) fail(`Public lineups cover ${lineupTeamIds.size} teams; expected 20.`);
const publicLineupText = await readFile(join(root, 'assets/lineups.json'), 'utf8');
if (/https?:\/\/|checkedAt|reviewedAt|projectedMinutes|predictedPoints|"minutes"/i.test(publicLineupText)) fail('Public lineups contain private research or raw prediction fields.');
for (const path of ['README.md', 'pred.xlsx', 'scripts/build-data.mjs', 'fetch_predicted_points.py', 'data/fdr-data.json', 'data/ffh_players_compact.json']) {
  try { await stat(join(root, path)); fail(`Private file was published: ${path}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log(`Validated ${relativeFiles.length} public files, ${publicFixtures.fixtures.length} fixtures, ${publicPlayers.players.length} players, and ${lineupTeamIds.size} predicted lineups.`);
