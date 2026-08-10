import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildPlayerDisplayNames } from '../scripts/build-player-display-names.mjs';
import { deriveRollingGameweekRange, fetchJsonWithRetry, validatePredictionSnapshot } from '../scripts/prediction-refresh-lib.mjs';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const positions = ['GK', 'DEF', 'MID', 'FWD'];

function makeSnapshot({ min = 5, max = 14, fetchedAt = new Date().toISOString() } = {}) {
  const players = positions.map((position, index) => ({
    fullName: `${['Alpha Keeper', 'Beta Defender', 'Gamma Midfielder', 'Delta Forward'][index]}`,
    price: 5 + index,
    position,
    ownership: 1,
    status: 'a',
    team: { shortName: `T${index + 1}`, fullName: ['Arsenal', 'Aston Villa', 'Bournemouth', 'Brentford'][index] },
    fixtures: Array.from({ length: max - min + 1 }, (_, offset) => ({
      gameweek: min + offset,
      opponent: { shortName: `O${offset}` },
      isHome: offset % 2 === 0,
      predictions: { points: 2 + index + offset / 10 },
    })),
  }));
  return {
    source: 'test', fetchedAt, gameweeks: { min, max }, count: players.length,
    countsByPosition: Object.fromEntries(positions.map((position) => [position, 1])), players,
  };
}

function makeBootstrap(nextGameweek = 5) {
  return {
    events: Array.from({ length: 38 }, (_, index) => ({ id: index + 1, is_next: index + 1 === nextGameweek })),
    teams: ['Arsenal', 'Aston Villa', 'Bournemouth', 'Brentford'].map((name, index) => ({ id: index + 1, name })),
    elements: [
      ['Alpha', 'Keeper'], ['Beta', 'Defender'], ['Gamma', 'Midfielder'], ['Delta', 'Forward'],
    ].map(([first_name, second_name], index) => ({ id: 100 + index, first_name, second_name, web_name: second_name, team: index + 1 })),
  };
}

test('derives rolling gameweek ranges and caps them at GW38', () => {
  assert.deepEqual(deriveRollingGameweekRange(makeBootstrap(1)), { min: 1, max: 10 });
  assert.deepEqual(deriveRollingGameweekRange(makeBootstrap(18)), { min: 18, max: 27 });
  assert.deepEqual(deriveRollingGameweekRange(makeBootstrap(34)), { min: 34, max: 38 });
  assert.equal(deriveRollingGameweekRange({ events: [{ id: 38, is_next: false }] }), null);
});

test('validates a complete prediction snapshot and official identities', () => {
  const snapshot = makeSnapshot();
  const names = buildPlayerDisplayNames(snapshot, makeBootstrap(), '2026-08-10T00:00:00Z');
  const result = validatePredictionSnapshot(snapshot, { minGameweek: 5, maxGameweek: 14, minimumPlayerCount: 0, nameSnapshot: names });
  assert.equal(result.playerCount, 4);
});

test('rejects empty, truncated, duplicate, malformed and stale predictions', () => {
  const empty = makeSnapshot();
  empty.players = [];
  empty.count = 0;
  empty.countsByPosition = Object.fromEntries(positions.map((position) => [position, 0]));
  assert.throws(() => validatePredictionSnapshot(empty), /only 0 players/);

  assert.throws(() => validatePredictionSnapshot(makeSnapshot()), /expected at least 300/);

  const duplicate = makeSnapshot();
  duplicate.players[1].fullName = duplicate.players[0].fullName;
  assert.throws(() => validatePredictionSnapshot(duplicate, { minimumPlayerCount: 0 }), /Duplicate prediction player/);

  const outOfRange = makeSnapshot();
  outOfRange.players[0].fixtures[0].gameweek = 4;
  assert.throws(() => validatePredictionSnapshot(outOfRange, { minimumPlayerCount: 0 }), /out of range/);

  const nonFinite = makeSnapshot();
  nonFinite.players[0].fixtures[0].predictions.points = Number.NaN;
  assert.throws(() => validatePredictionSnapshot(nonFinite, { minimumPlayerCount: 0 }), /Invalid predicted points/);

  const stale = makeSnapshot({ fetchedAt: '2026-08-01T00:00:00Z' });
  assert.throws(() => validatePredictionSnapshot(stale, { minimumPlayerCount: 0, maxAgeMinutes: 60, now: Date.parse('2026-08-10T00:00:00Z') }), /older than 60 minutes/);
});

test('rejects missing and duplicate official FPL identities', () => {
  const snapshot = makeSnapshot();
  const names = buildPlayerDisplayNames(snapshot, makeBootstrap());
  delete names.matches[snapshot.players[0].fullName];
  assert.throws(() => validatePredictionSnapshot(snapshot, { minimumPlayerCount: 0, nameSnapshot: names }), /Missing or invalid official/);

  const duplicateNames = buildPlayerDisplayNames(snapshot, makeBootstrap());
  duplicateNames.matches[snapshot.players[1].fullName].id = duplicateNames.matches[snapshot.players[0].fullName].id;
  assert.throws(() => validatePredictionSnapshot(snapshot, { minimumPlayerCount: 0, nameSnapshot: duplicateNames }), /duplicated/);

  const duplicatePlayers = makeSnapshot();
  duplicatePlayers.players[1].fullName = 'Another Keeper';
  duplicatePlayers.players[1].team.fullName = 'Arsenal';
  const bootstrap = makeBootstrap();
  bootstrap.elements = [bootstrap.elements[0]];
  assert.throws(() => buildPlayerDisplayNames(duplicatePlayers, bootstrap), /matched more than once/);
});

test('retries transient bootstrap errors and does not retry fatal responses', async () => {
  let attempts = 0;
  const payload = await fetchJsonWithRetry('https://example.test', {
    baseDelayMs: 0,
    sleep: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) return { ok: false, status: 500, headers: { get: () => null } };
      return { ok: true, json: async () => ({ events: [] }) };
    },
  });
  assert.deepEqual(payload, { events: [] });
  assert.equal(attempts, 3);

  attempts = 0;
  await assert.rejects(() => fetchJsonWithRetry('https://example.test', {
    sleep: async () => {},
    fetchImpl: async () => { attempts += 1; return { ok: false, status: 403, headers: { get: () => null } }; },
  }), /Request failed \(403\)/);
  assert.equal(attempts, 1);

  attempts = 0;
  await assert.rejects(() => fetchJsonWithRetry('https://example.test', {
    sleep: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      return { ok: true, json: async () => { throw new SyntaxError('bad json'); } };
    },
  }), /invalid JSON/);
  assert.equal(attempts, 1);
});

test('requires FFH_TOKEN before a live refresh starts', async () => {
  const environment = { ...process.env };
  delete environment.FFH_TOKEN;
  await assert.rejects(() => execFileAsync(process.execPath, ['scripts/refresh-predictions.mjs'], { cwd: root, env: environment }), /FFH_TOKEN is required/);
});

test('runs an offline staged refresh without changing tracked snapshots', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'fixture-lens-integration-'));
  const bootstrapPath = join(temporary, 'bootstrap.json');
  const predictionsPath = join(temporary, 'predictions.json');
  const publicPath = join(temporary, 'public');
  const trackedPredictionPath = join(root, 'data', 'ffh_players_compact.json');
  const before = await readFile(trackedPredictionPath, 'utf8');
  try {
    await writeFile(bootstrapPath, JSON.stringify(makeBootstrap()));
    await writeFile(predictionsPath, JSON.stringify(makeSnapshot({ fetchedAt: '2026-08-10T00:00:00Z' })));
    await execFileAsync(process.execPath, [
      'scripts/refresh-predictions.mjs',
      '--bootstrap-input', bootstrapPath,
      '--prediction-input', predictionsPath,
      '--output', publicPath,
      '--minimum-player-count', '0',
      '--max-age-minutes', '0',
    ], { cwd: root });
    const released = JSON.parse(await readFile(join(publicPath, 'assets', 'players.json'), 'utf8'));
    assert.deepEqual(released.gameweeks, { min: 5, max: 14 });
    assert.equal(released.players.length, 4);
    const publicText = await readFile(join(publicPath, 'assets', 'players.json'), 'utf8');
    assert.doesNotMatch(publicText, /"source"|"fetchedAt"|fantasyfootballhub/i);
    assert.equal(await readFile(trackedPredictionPath, 'utf8'), before);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('leaves the existing release untouched when the season has no next gameweek', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'fixture-lens-no-next-'));
  const bootstrapPath = join(temporary, 'bootstrap.json');
  const predictionsPath = join(temporary, 'predictions.json');
  const publicPath = join(temporary, 'public');
  const outputPath = join(temporary, 'actions-output.txt');
  try {
    const bootstrap = makeBootstrap();
    bootstrap.events.forEach((event) => { event.is_next = false; });
    await writeFile(bootstrapPath, JSON.stringify(bootstrap));
    await writeFile(predictionsPath, JSON.stringify(makeSnapshot()));
    await mkdir(publicPath);
    await writeFile(join(publicPath, 'marker.txt'), 'existing release');
    await execFileAsync(process.execPath, [
      'scripts/refresh-predictions.mjs',
      '--bootstrap-input', bootstrapPath,
      '--prediction-input', predictionsPath,
      '--output', publicPath,
    ], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: outputPath } });
    assert.equal(await readFile(join(publicPath, 'marker.txt'), 'utf8'), 'existing release');
    assert.match(await readFile(outputPath, 'utf8'), /has_upcoming=false/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('workflow gates artifact upload and deployment on a successful refresh', async () => {
  const workflow = await readFile(join(root, '.github', 'workflows', 'refresh-predictions.yml'), 'utf8');
  assert.match(workflow, /Upload sanitized Pages artifact[\s\S]*if: steps\.refresh\.outputs\.has_upcoming == 'true'/);
  assert.match(workflow, /deploy:[\s\S]*if: needs\.build\.result == 'success' && needs\.build\.outputs\.has_upcoming == 'true'/);
  assert.match(workflow, /permissions:\s+pages: write\s+id-token: write/);
});
