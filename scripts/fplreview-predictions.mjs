import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'parse_fplreview_xlsx.py');

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error((stderr || stdout || `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`).trim()));
    });
  });
}

export async function loadFplReviewWorkbook(input = 'pred.xlsx', options = {}) {
  const work = await mkdtemp(join(tmpdir(), 'fixture-lens-fplreview-'));
  const output = join(work, 'predictions.json');
  try {
    await run(options.python || process.env.PYTHON || 'python', [scriptPath, '--input', resolve(input), '--output', output, '--sheet', options.sheet || 'pred']);
    return JSON.parse(await readFile(output, 'utf8'));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function optionalNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}

export function mergePredictionSources(ffhSnapshot, nameSnapshot, reviewSnapshot) {
  if (!Array.isArray(ffhSnapshot?.players) || !Array.isArray(reviewSnapshot?.players)) throw new Error('Prediction sources have an invalid shape.');
  const reviewById = new Map();
  for (const player of reviewSnapshot.players) {
    const id = Number(player.id);
    if (!Number.isInteger(id) || id <= 0 || reviewById.has(id)) throw new Error(`Invalid or duplicate FPL Review player ID: ${player.id}.`);
    reviewById.set(id, player);
  }

  const coverage = { matchedPlayers: 0, fallbackPlayers: 0, blendedFixtures: 0, fallbackFixtures: 0 };
  const players = ffhSnapshot.players.map((player) => {
    const official = nameSnapshot?.matches?.[player.fullName];
    if (!official || !Number.isInteger(Number(official.id))) throw new Error(`Missing official FPL identity for ${player.fullName}.`);
    const review = reviewById.get(Number(official.id));
    if (review) coverage.matchedPlayers += 1;
    else coverage.fallbackPlayers += 1;
    const reviewFixtures = new Map((review?.fixtures || []).map((fixture) => [Number(fixture.gameweek), fixture]));
    const fixtures = player.fixtures.map((fixture) => {
      const reviewFixture = reviewFixtures.get(Number(fixture.gameweek));
      const ffhPoints = optionalNumber(fixture.predictions?.points);
      const ffhMinutes = optionalNumber(fixture.predictions?.minutes);
      if (ffhPoints === null) throw new Error(`Missing FFH points for ${player.fullName}, GW ${fixture.gameweek}.`);
      const reviewPoints = optionalNumber(reviewFixture?.points);
      const reviewMinutes = optionalNumber(reviewFixture?.minutes);
      if (reviewPoints !== null && reviewMinutes !== null) coverage.blendedFixtures += 1;
      else coverage.fallbackFixtures += 1;
      return {
        ...fixture,
        predictions: {
          ...fixture.predictions,
          points: reviewPoints === null ? ffhPoints : (ffhPoints + reviewPoints) / 2,
          minutes: reviewMinutes ?? ffhMinutes,
        },
      };
    });
    return { ...player, eliteOwnership: optionalNumber(review?.eliteOwnership), fixtures };
  });

  return { snapshot: { ...ffhSnapshot, players }, coverage };
}
