export const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];

const DEFAULT_MINIMUM_PLAYERS = 300;
const MINIMUM_POSITION_COUNTS = { GK: 20, DEF: 70, MID: 70, FWD: 20 };

function fail(message) {
  throw new Error(message);
}

class MalformedJsonError extends Error {}

export function deriveRollingGameweekRange(bootstrap, windowSize = 10) {
  if (!Number.isInteger(windowSize) || windowSize < 1) fail('Prediction window must be a positive integer.');
  const events = Array.isArray(bootstrap?.events) ? bootstrap.events : [];
  const nextEvent = events.find((event) => event?.is_next === true);
  if (!nextEvent) return null;
  if (!Number.isInteger(nextEvent.id) || nextEvent.id < 1 || nextEvent.id > 38) {
    fail('Official FPL data contains an invalid next gameweek.');
  }
  return { min: nextEvent.id, max: Math.min(nextEvent.id + windowSize - 1, 38) };
}

export function validatePredictionSnapshot(snapshot, options = {}) {
  const {
    minGameweek = snapshot?.gameweeks?.min,
    maxGameweek = snapshot?.gameweeks?.max,
    maxAgeMinutes = 0,
    minimumPlayerCount = DEFAULT_MINIMUM_PLAYERS,
    nameSnapshot = null,
    now = Date.now(),
  } = options;

  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('Prediction snapshot must be a JSON object.');
  if (!Number.isInteger(minGameweek) || !Number.isInteger(maxGameweek) || minGameweek < 1 || maxGameweek > 38 || minGameweek > maxGameweek) {
    fail('Expected prediction gameweek range is invalid.');
  }
  if (snapshot.gameweeks?.min !== minGameweek || snapshot.gameweeks?.max !== maxGameweek) {
    fail(`Prediction range is ${snapshot.gameweeks?.min}-${snapshot.gameweeks?.max}; expected ${minGameweek}-${maxGameweek}.`);
  }

  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetchedAt)) fail('Prediction fetchedAt must be a valid timestamp.');
  if (fetchedAt > now + 5 * 60_000) fail('Prediction fetchedAt is unexpectedly in the future.');
  if (maxAgeMinutes > 0 && now - fetchedAt > maxAgeMinutes * 60_000) {
    fail(`Prediction snapshot is older than ${maxAgeMinutes} minutes.`);
  }

  if (!Array.isArray(snapshot.players)) fail('Prediction snapshot is missing its players array.');
  if (snapshot.count !== snapshot.players.length) fail('Prediction player count does not match the players array.');
  if (snapshot.players.length < minimumPlayerCount) {
    fail(`Prediction snapshot contains only ${snapshot.players.length} players; expected at least ${minimumPlayerCount}.`);
  }

  const actualCounts = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  const playerNames = new Set();
  const officialIds = new Set();

  for (const player of snapshot.players) {
    if (!player || typeof player !== 'object') fail('Prediction snapshot contains an invalid player.');
    const name = typeof player.fullName === 'string' ? player.fullName.trim() : '';
    if (!name) fail('Prediction player is missing fullName.');
    if (playerNames.has(name)) fail(`Duplicate prediction player: ${name}.`);
    playerNames.add(name);
    if (!POSITIONS.includes(player.position)) fail(`Invalid position for ${name}.`);
    actualCounts[player.position] += 1;
    if (!Number.isFinite(Number(player.price)) || Number(player.price) <= 0) fail(`Invalid price for ${name}.`);
    if (!player.team || typeof player.team.fullName !== 'string' || !player.team.fullName.trim()) fail(`Invalid team for ${name}.`);
    if (!Array.isArray(player.fixtures) || player.fixtures.length === 0) fail(`Missing fixtures for ${name}.`);

    const fixtureKeys = new Set();
    for (const fixture of player.fixtures) {
      if (!Number.isInteger(fixture?.gameweek) || fixture.gameweek < minGameweek || fixture.gameweek > maxGameweek) {
        fail(`Fixture gameweek is out of range for ${name}.`);
      }
      if (typeof fixture.isHome !== 'boolean') fail(`Invalid fixture venue for ${name}, GW ${fixture.gameweek}.`);
      const opponent = fixture.opponent?.shortName;
      if (typeof opponent !== 'string' || !opponent.trim()) fail(`Missing opponent for ${name}, GW ${fixture.gameweek}.`);
      if (!Number.isFinite(fixture.predictions?.points)) fail(`Invalid predicted points for ${name}, GW ${fixture.gameweek}.`);
      const fixtureKey = `${fixture.gameweek}:${opponent}:${fixture.isHome ? 'H' : 'A'}`;
      if (fixtureKeys.has(fixtureKey)) fail(`Duplicate fixture for ${name}: ${fixtureKey}.`);
      fixtureKeys.add(fixtureKey);
    }

    if (nameSnapshot) {
      const match = nameSnapshot.matches?.[name];
      if (!match || !Number.isInteger(Number(match.id)) || Number(match.id) <= 0 || !Number.isInteger(Number(match.teamId)) || Number(match.teamId) <= 0) {
        fail(`Missing or invalid official FPL identity for ${name}.`);
      }
      const officialId = Number(match.id);
      if (officialIds.has(officialId)) fail(`Official FPL player ID ${officialId} is duplicated.`);
      officialIds.add(officialId);
    }
  }

  for (const position of POSITIONS) {
    if (snapshot.countsByPosition?.[position] !== actualCounts[position]) {
      fail(`Prediction count for ${position} is inconsistent.`);
    }
    if (minimumPlayerCount > 0 && actualCounts[position] < MINIMUM_POSITION_COUNTS[position]) {
      fail(`Prediction snapshot contains only ${actualCounts[position]} ${position} players.`);
    }
  }
  if (nameSnapshot && officialIds.size !== snapshot.players.length) fail('Official FPL identity count is incomplete.');

  return { playerCount: snapshot.players.length, countsByPosition: actualCounts, fetchedAt: snapshot.fetchedAt };
}

export async function fetchJsonWithRetry(url, options = {}) {
  const { attempts = 4, baseDelayMs = 1_000, fetchImpl = fetch, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = options;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (response.ok) {
        try {
          return await response.json();
        } catch (error) {
          throw new MalformedJsonError(`Server returned invalid JSON: ${url}`, { cause: error });
        }
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts) throw new Error(`Request failed (${response.status}): ${url}`);
      const retryAfter = Number(response.headers?.get?.('retry-after'));
      const delay = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1_000, 30_000) : Math.min(baseDelayMs * 2 ** (attempt - 1), 8_000);
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (error instanceof MalformedJsonError) throw error;
      if (attempt === attempts || /Request failed \((?:4\d\d|5\d\d)\)/.test(error.message)) throw error;
      await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), 8_000));
    }
  }
  throw lastError;
}
