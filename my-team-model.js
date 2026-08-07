export const POSITION_ORDER = ['GK', 'DEF', 'MID', 'FWD'];
export const POSITION_QUOTAS = Object.freeze({ GK: 2, DEF: 5, MID: 5, FWD: 3 });
export const BUDGET = 100;
export const MAX_FREE_TRANSFERS = 5;
export const CHIP_TYPES = Object.freeze({ WILDCARD: 'wildcard', FREE_HIT: 'free_hit', BENCH_BOOST: 'bench_boost', TRIPLE_CAPTAIN: 'triple_captain' });
export const CHIP_LABELS = Object.freeze({ [CHIP_TYPES.WILDCARD]: 'Wildcard', [CHIP_TYPES.FREE_HIT]: 'Free Hit', [CHIP_TYPES.BENCH_BOOST]: 'Bench Boost', [CHIP_TYPES.TRIPLE_CAPTAIN]: 'Triple Captain' });
export const VALID_FORMATIONS = Object.freeze([
  [3, 4, 3], [3, 5, 2], [4, 3, 3], [4, 4, 2],
  [4, 5, 1], [5, 2, 3], [5, 3, 2], [5, 4, 1],
]);

const round = (value) => Math.round((value + Number.EPSILON) * 10) / 10;
const copyLineup = (lineup) => ({
  ...lineup,
  starters: [...lineup.starters],
  benchOutfieldIds: [...lineup.benchOutfieldIds],
});

export function predictionFor(player, gameweek) {
  const fixture = player?.fixtures?.find((item) => Number(item.gameweek) === Number(gameweek));
  return fixture && Number.isFinite(Number(fixture.points)) ? Number(fixture.points) : null;
}

export function pointsFor(player, gameweek) {
  return predictionFor(player, gameweek) ?? 0;
}

export function horizonTotal(player, gameweeks) {
  return round(gameweeks.reduce((total, gameweek) => total + pointsFor(player, gameweek), 0));
}

function playerComparator(gameweek) {
  return (left, right) => pointsFor(right, gameweek) - pointsFor(left, gameweek) || left.id - right.id;
}

export function validateSquad(players) {
  const counts = Object.fromEntries(POSITION_ORDER.map((position) => [position, 0]));
  const clubs = new Map();
  const ids = new Set();
  const errors = [];
  let cost = 0;

  for (const player of players) {
    if (!player || !Number.isInteger(player.id)) { errors.push('Squad contains an unknown player.'); continue; }
    if (ids.has(player.id)) errors.push(`${player.displayName || player.fullName} is selected more than once.`);
    ids.add(player.id);
    if (!(player.position in POSITION_QUOTAS)) errors.push(`${player.displayName || player.fullName} has an invalid position.`);
    else counts[player.position] += 1;
    clubs.set(player.team.id, (clubs.get(player.team.id) || 0) + 1);
    cost += Number(player.price) || 0;
  }

  for (const position of POSITION_ORDER) {
    if (counts[position] > POSITION_QUOTAS[position]) errors.push(`Too many ${position} players.`);
  }
  for (const [teamId, count] of clubs) {
    if (count > 3) {
      const clubName = players.find((player) => player?.team?.id === teamId)?.team?.fullName || 'one club';
      errors.push(`No more than 3 players can be selected from ${clubName}.`);
    }
  }
  if (cost > BUDGET + 0.001) errors.push(`Squad is £${round(cost - BUDGET).toFixed(1)}m over budget.`);
  const complete = players.length === 15 && POSITION_ORDER.every((position) => counts[position] === POSITION_QUOTAS[position]);
  return { valid: complete && errors.length === 0, complete, errors, counts, clubs, cost: round(cost), remaining: round(BUDGET - cost) };
}

export function canSelectPlayer(squad, candidate, replacingId = null) {
  const base = replacingId === null ? squad : squad.filter((player) => player.id !== replacingId);
  const replaced = replacingId === null ? null : squad.find((player) => player.id === replacingId);
  if (!candidate) return { allowed: false, reason: 'Player data is unavailable.' };
  if (base.some((player) => player.id === candidate.id)) return { allowed: false, reason: 'This player is already in your squad.' };
  if (replaced && replaced.position !== candidate.position) return { allowed: false, reason: `Choose another ${replaced.position}.` };
  const candidatePositionCount = base.filter((player) => player.position === candidate.position).length;
  if (candidatePositionCount >= POSITION_QUOTAS[candidate.position]) return { allowed: false, reason: `${candidate.position} slots are full.` };
  if (base.filter((player) => player.team.id === candidate.team.id).length >= 3) return { allowed: false, reason: `You already have 3 ${candidate.team.fullName} players.` };
  const nextCost = base.reduce((total, player) => total + player.price, 0) + candidate.price;
  if (nextCost > BUDGET + 0.001) return { allowed: false, reason: `This selection would exceed the £${BUDGET.toFixed(1)}m budget.` };
  return { allowed: true, reason: '' };
}

function copyTransfers(transfers = {}) {
  return Object.fromEntries(Object.entries(transfers).map(([gameweek, moves]) => [gameweek, (moves || []).map((move) => ({ outId: Number(move.outId), inId: Number(move.inId) }))]));
}

export function applyTransfers(previousSquad, transfers = []) {
  const ids = new Set(previousSquad.map((player) => player.id));
  const outgoing = new Set(transfers.map((move) => Number(move.outId)));
  for (const move of transfers) {
    if (!ids.has(Number(move.outId))) return { valid: false, error: 'A transfer-out player is not in the previous squad.', players: previousSquad };
    if (Number(move.outId) === Number(move.inId)) return { valid: false, error: 'A transfer cannot replace a player with themselves.', players: previousSquad };
    if (ids.has(Number(move.inId)) && !outgoing.has(Number(move.inId))) return { valid: false, error: 'A transfer-in player is already in the previous squad.', players: previousSquad };
  }
  if (new Set(transfers.map((move) => Number(move.inId))).size !== transfers.length) return { valid: false, error: 'A player cannot be transferred in twice.', players: previousSquad };
  for (const move of transfers) ids.delete(Number(move.outId));
  for (const move of transfers) ids.add(Number(move.inId));
  return { valid: ids.size === previousSquad.length, error: ids.size === previousSquad.length ? '' : 'Transfers must preserve a 15-player squad.', players: [...ids] };
}

export function transferSummary(availableFreeTransfers, transferCount, chip = null) {
  const available = Math.max(0, Math.min(MAX_FREE_TRANSFERS, Number(availableFreeTransfers) || 0));
  const count = Math.max(0, Number(transferCount) || 0);
  const unlimited = chip === CHIP_TYPES.WILDCARD || chip === CHIP_TYPES.FREE_HIT;
  const freeUsed = unlimited ? 0 : Math.min(available, count);
  const hits = unlimited ? 0 : Math.max(0, count - available);
  const bankAfter = unlimited ? available : Math.min(MAX_FREE_TRANSFERS, Math.max(0, available - count));
  return { available, count, freeUsed, hits, hitCost: hits * 4, bankAfter, unlimited };
}

export function chipHalf(gameweek) {
  return Number(gameweek) <= 19 ? 1 : 2;
}

export function chipKey(type, gameweek) {
  return `${type}${chipHalf(gameweek)}`;
}

export function chipIsAvailable(type, gameweek, chips = {}) {
  if (!type) return true;
  if (!Object.values(CHIP_TYPES).includes(type)) return false;
  if (type === CHIP_TYPES.FREE_HIT && Number(gameweek) === 1) return false;
  return !Object.entries(chips).some(([gameweekKey, selectedType]) => selectedType === type && chipHalf(gameweekKey) === chipHalf(gameweek) && Number(gameweekKey) !== Number(gameweek));
}

export function buildPlan(initialSquad, transferPlans = {}, chips = {}, gameweeks = [], startingFreeTransfers = 1, playerCatalog = initialSquad) {
  let current = [...initialSquad];
  const catalog = new Map(playerCatalog.map((player) => [player.id, player]));
  let bank = Math.max(0, Math.min(MAX_FREE_TRANSFERS, Number(startingFreeTransfers) || 0));
  const squads = {};
  const summaries = {};
  const preChipSquads = {};
  for (const gameweek of gameweeks) {
    const key = String(gameweek);
    const preChip = [...current];
    const moves = transferPlans[key] || transferPlans[gameweek] || [];
    const applied = applyTransfers(preChip, moves);
    current = applied.valid ? applied.players.map((id) => catalog.get(id)).filter(Boolean) : preChip;
    const chip = chips[key] || chips[gameweek] || null;
    const available = gameweek === gameweeks[0] ? bank : Math.min(MAX_FREE_TRANSFERS, bank + 1);
    summaries[key] = { ...transferSummary(available, moves.length, chip), chip, valid: applied.valid, error: applied.error };
    squads[key] = [...current];
    preChipSquads[key] = preChip;
    bank = summaries[key].bankAfter;
    if (chip === CHIP_TYPES.FREE_HIT) current = preChip;
  }
  return { squads, summaries, preChipSquads, finalBank: bank };
}

export function replaceAtGameweek(initialSquad, transferPlans, gameweek, oldId, newPlayer, chips = {}, gameweeks = [], startingFreeTransfers = 1, playerCatalog = initialSquad) {
  const nextPlans = copyTransfers(transferPlans);
  const key = String(gameweek);
  const moves = nextPlans[key] || [];
  const existing = moves.find((move) => move.inId === Number(oldId));
  if (existing) existing.inId = newPlayer.id;
  else moves.push({ outId: Number(oldId), inId: newPlayer.id });
  nextPlans[key] = moves;
  const plan = buildPlan(initialSquad, nextPlans, chips, gameweeks, startingFreeTransfers, playerCatalog);
  const resultingSquad = plan.squads[key] || [];
  const validation = validateSquad(resultingSquad);
  if (!validation.valid) return { ok: false, error: validation.errors[0] || 'That transfer would make the squad invalid.', transferPlans };
  return { ok: true, error: '', transferPlans: nextPlans, plan };
}

export function formationFor(lineup, playerById) {
  const counts = { DEF: 0, MID: 0, FWD: 0 };
  for (const id of lineup.starters) {
    const position = playerById.get(id)?.position;
    if (position in counts) counts[position] += 1;
  }
  return `${counts.DEF}-${counts.MID}-${counts.FWD}`;
}

export function validateLineup(lineup, squad) {
  const playerById = new Map(squad.map((player) => [player.id, player]));
  const allIds = [...lineup.starters, lineup.benchGoalkeeperId, ...lineup.benchOutfieldIds];
  if (lineup.starters.length !== 11 || lineup.benchOutfieldIds.length !== 3 || allIds.length !== 15) return { valid: false, error: 'Lineup must contain 11 starters and 4 substitutes.' };
  if (new Set(allIds).size !== 15 || allIds.some((id) => !playerById.has(id))) return { valid: false, error: 'Lineup does not match the selected squad.' };
  const starters = lineup.starters.map((id) => playerById.get(id));
  const goalkeeperCount = starters.filter((player) => player.position === 'GK').length;
  const defenders = starters.filter((player) => player.position === 'DEF').length;
  const midfielders = starters.filter((player) => player.position === 'MID').length;
  const forwards = starters.filter((player) => player.position === 'FWD').length;
  if (goalkeeperCount !== 1 || defenders < 3 || defenders > 5 || midfielders < 2 || midfielders > 5 || forwards < 1 || forwards > 3) return { valid: false, error: 'That substitution would create an invalid FPL formation.' };
  if (playerById.get(lineup.benchGoalkeeperId)?.position !== 'GK') return { valid: false, error: 'The goalkeeper substitute must be a goalkeeper.' };
  if (!lineup.starters.includes(lineup.captainId) || !lineup.starters.includes(lineup.viceCaptainId) || lineup.captainId === lineup.viceCaptainId) return { valid: false, error: 'Captain and vice-captain must be different starting players.' };
  return { valid: true, error: '' };
}

function assignCaptaincy(lineup, squad, gameweek) {
  const playerById = new Map(squad.map((player) => [player.id, player]));
  const ranked = lineup.starters.map((id) => playerById.get(id)).sort(playerComparator(gameweek));
  lineup.captainId = ranked[0].id;
  lineup.viceCaptainId = ranked[1].id;
  return lineup;
}

export function selectAutomaticLineup(squad, gameweek) {
  const squadState = validateSquad(squad);
  if (!squadState.valid) throw new Error('Complete a valid 15-player squad before selecting a lineup.');
  const byPosition = Object.fromEntries(POSITION_ORDER.map((position) => [position, squad.filter((player) => player.position === position).sort(playerComparator(gameweek))]));
  let best = null;
  for (const [defenders, midfielders, forwards] of VALID_FORMATIONS) {
    const starters = [byPosition.GK[0], ...byPosition.DEF.slice(0, defenders), ...byPosition.MID.slice(0, midfielders), ...byPosition.FWD.slice(0, forwards)];
    const score = starters.reduce((total, player) => total + pointsFor(player, gameweek), 0);
    if (!best || score > best.score + 0.0001) best = { starters, score };
  }
  const starterIds = new Set(best.starters.map((player) => player.id));
  const benchOutfield = squad.filter((player) => player.position !== 'GK' && !starterIds.has(player.id)).sort(playerComparator(gameweek));
  const lineup = {
    starters: best.starters.map((player) => player.id),
    benchGoalkeeperId: byPosition.GK[1].id,
    benchOutfieldIds: benchOutfield.map((player) => player.id),
    captainId: 0,
    viceCaptainId: 0,
    mode: 'auto',
  };
  return assignCaptaincy(lineup, squad, gameweek);
}

export function lineupTotals(squad, lineup, gameweek, chip = null) {
  const playerById = new Map(squad.map((player) => [player.id, player]));
  const base = lineup.starters.reduce((total, id) => total + pointsFor(playerById.get(id), gameweek), 0);
  const captainPoints = pointsFor(playerById.get(lineup.captainId), gameweek);
  const captainBonus = captainPoints * (chip === CHIP_TYPES.TRIPLE_CAPTAIN ? 2 : 1);
  const bench = [lineup.benchGoalkeeperId, ...lineup.benchOutfieldIds].reduce((total, id) => total + pointsFor(playerById.get(id), gameweek), 0);
  const benchBonus = chip === CHIP_TYPES.BENCH_BOOST ? bench : 0;
  return { base: round(base), captainBonus: round(captainBonus), benchBonus: round(benchBonus), total: round(base + captainBonus + benchBonus), bench: round(bench) };
}

export function swapLineupPlayers(lineup, squad, starterId, benchId) {
  const next = copyLineup(lineup);
  const starterIndex = next.starters.indexOf(starterId);
  if (starterIndex < 0) return { ok: false, error: 'Select a starting player first.', lineup };
  if (next.benchGoalkeeperId === benchId) next.benchGoalkeeperId = starterId;
  else {
    const benchIndex = next.benchOutfieldIds.indexOf(benchId);
    if (benchIndex < 0) return { ok: false, error: 'Select a substitute to swap in.', lineup };
    next.benchOutfieldIds[benchIndex] = starterId;
  }
  next.starters[starterIndex] = benchId;
  next.mode = 'manual';
  const validation = validateLineup(next, squad);
  return validation.valid ? { ok: true, error: '', lineup: next } : { ok: false, error: validation.error, lineup };
}

export function moveBenchPlayer(lineup, playerId, direction) {
  const next = copyLineup(lineup);
  const index = next.benchOutfieldIds.indexOf(playerId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.benchOutfieldIds.length) return lineup;
  [next.benchOutfieldIds[index], next.benchOutfieldIds[target]] = [next.benchOutfieldIds[target], next.benchOutfieldIds[index]];
  next.mode = 'manual';
  return next;
}

export function setCaptainRole(lineup, playerId, role) {
  if (!lineup.starters.includes(playerId)) return { ok: false, error: 'Captain and vice-captain must be in the starting XI.', lineup };
  const next = copyLineup(lineup);
  if (role === 'captain') {
    if (next.viceCaptainId === playerId) next.viceCaptainId = next.captainId;
    next.captainId = playerId;
  } else {
    if (next.captainId === playerId) next.captainId = next.viceCaptainId;
    next.viceCaptainId = playerId;
  }
  next.mode = 'manual';
  return { ok: true, error: '', lineup: next };
}

export function replacePlayerInLineup(lineup, squad, oldId, newId, gameweek) {
  const next = copyLineup(lineup);
  next.starters = next.starters.map((id) => id === oldId ? newId : id);
  if (next.benchGoalkeeperId === oldId) next.benchGoalkeeperId = newId;
  next.benchOutfieldIds = next.benchOutfieldIds.map((id) => id === oldId ? newId : id);
  if (next.captainId === oldId || next.viceCaptainId === oldId) assignCaptaincy(next, squad, gameweek);
  return next;
}
