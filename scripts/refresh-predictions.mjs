import { access, appendFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { deriveRollingGameweekRange, fetchJsonWithRetry } from './prediction-refresh-lib.mjs';

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length) throw new Error(`Invalid argument: ${key}`);
    values[key.slice(2)] = argv[++index];
  }
  return values;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args[0]} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

async function setActionsOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n');
  await appendFile(process.env.GITHUB_OUTPUT, `${lines}\n`);
}

async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function replaceDirectory(staged, output) {
  const backup = `${output}.previous-${randomUUID()}`;
  const hadOutput = await pathExists(output);
  if (hadOutput) await rename(output, backup);
  try {
    await rename(staged, output);
  } catch (error) {
    if (hadOutput) await rename(backup, output);
    throw error;
  }
  if (hadOutput) await rm(backup, { recursive: true, force: true });
}

const args = parseArgs(process.argv.slice(2));
const output = resolve(args.output || 'public');
const windowSize = Number(args.window || 10);
const maximumAge = Number(args['max-age-minutes'] ?? 60);
const minimumPlayers = Number(args['minimum-player-count'] ?? 300);
const suppliedPredictions = args['prediction-input'] ? resolve(args['prediction-input']) : null;
if (!suppliedPredictions && !(process.env.FFH_TOKEN || '').trim()) {
  throw new Error('FFH_TOKEN is required for a live prediction refresh.');
}

const privateWork = await mkdtemp(join(tmpdir(), 'fixture-lens-refresh-'));
const stagedPublic = await mkdtemp(join(dirname(output), '.fixture-lens-public-'));
let stagedPublicMoved = false;
try {
  const bootstrapPath = join(privateWork, 'fpl-bootstrap.json');
  let bootstrap;
  if (args['bootstrap-input']) {
    bootstrap = JSON.parse(await readFile(resolve(args['bootstrap-input']), 'utf8'));
  } else {
    bootstrap = await fetchJsonWithRetry(FPL_URL);
  }
  await writeFile(bootstrapPath, `${JSON.stringify(bootstrap)}\n`);

  const range = deriveRollingGameweekRange(bootstrap, windowSize);
  if (!range) {
    console.log('No upcoming FPL gameweek exists; leaving the current public deployment unchanged.');
    await setActionsOutput({ has_upcoming: false });
  } else {
    const predictionPath = suppliedPredictions || join(privateWork, 'predictions.json');
    const nameMapPath = join(privateWork, 'player-names.json');
    if (!suppliedPredictions) {
      const python = process.env.PYTHON || 'python';
      await run(python, [
        'fetch_predicted_points.py',
        '--min-gameweek', String(range.min),
        '--max-gameweek', String(range.max),
        '--output', predictionPath,
      ]);
    }

    await run(process.execPath, [
      'scripts/build-player-display-names.mjs',
      '--prediction-input', predictionPath,
      '--bootstrap-input', bootstrapPath,
      '--output', nameMapPath,
    ]);
    await run(process.execPath, [
      'scripts/validate-predictions.mjs',
      '--input', predictionPath,
      '--name-map-input', nameMapPath,
      '--min-gameweek', String(range.min),
      '--max-gameweek', String(range.max),
      '--max-age-minutes', String(maximumAge),
      '--minimum-player-count', String(minimumPlayers),
    ]);
    await run(process.execPath, [
      'scripts/build-public.mjs',
      '--prediction-input', predictionPath,
      '--name-map-input', nameMapPath,
      '--output', stagedPublic,
    ]);
    await run(process.execPath, [
      'scripts/validate-public.mjs',
      '--prediction-input', predictionPath,
      '--name-map-input', nameMapPath,
      '--public-dir', stagedPublic,
    ]);

    const predictions = JSON.parse(await readFile(predictionPath, 'utf8'));
    const lineups = JSON.parse(await readFile(join(stagedPublic, 'assets', 'lineups.json'), 'utf8'));
    const lineupTeams = lineups.fixtures.flatMap((fixture) => fixture.teams);
    const reviewedLineups = lineupTeams.filter((team) => team.predictionStatus === 'reviewed').length;
    await replaceDirectory(stagedPublic, output);
    stagedPublicMoved = true;
    await setActionsOutput({
      has_upcoming: true,
      min_gameweek: range.min,
      max_gameweek: range.max,
      player_count: predictions.count,
      fetched_at: predictions.fetchedAt,
      reviewed_lineups: reviewedLineups,
      automatic_lineups: lineupTeams.length - reviewedLineups,
    });
    console.log(`Prepared validated public predictions for GW${range.min}-${range.max}: ${predictions.count} players, ${reviewedLineups} reviewed lineups, ${lineupTeams.length - reviewedLineups} automatic lineups.`);
  }
} finally {
  await rm(privateWork, { recursive: true, force: true });
  if (!stagedPublicMoved) await rm(stagedPublic, { recursive: true, force: true });
}
