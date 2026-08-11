export const SLOT_DEFINITIONS = Object.freeze({
  GK: { label: 'GK', positions: ['GK'] },
  RB: { label: 'RB', positions: ['DEF'] }, RCB: { label: 'RCB', positions: ['DEF'] },
  CB: { label: 'CB', positions: ['DEF'] }, LCB: { label: 'LCB', positions: ['DEF'] },
  LB: { label: 'LB', positions: ['DEF'] },
  RWB: { label: 'RWB', positions: ['DEF', 'MID'] }, LWB: { label: 'LWB', positions: ['DEF', 'MID'] },
  DM: { label: 'DM', positions: ['MID'] }, RDM: { label: 'RDM', positions: ['MID'] }, LDM: { label: 'LDM', positions: ['MID'] },
  CM: { label: 'CM', positions: ['MID'] }, RCM: { label: 'RCM', positions: ['MID'] }, LCM: { label: 'LCM', positions: ['MID'] },
  AM: { label: 'AM', positions: ['MID', 'FWD'] }, RAM: { label: 'RAM', positions: ['MID', 'FWD'] }, LAM: { label: 'LAM', positions: ['MID', 'FWD'] },
  RM: { label: 'RM', positions: ['MID', 'FWD'] }, LM: { label: 'LM', positions: ['MID', 'FWD'] },
  RW: { label: 'RW', positions: ['MID', 'FWD'] }, LW: { label: 'LW', positions: ['MID', 'FWD'] },
  ST: { label: 'ST', positions: ['FWD'] }, RST: { label: 'RST', positions: ['FWD'] }, LST: { label: 'LST', positions: ['FWD'] },
});

const slot = (key, x, y) => Object.freeze({ key, x, y });

export const FORMATIONS = Object.freeze({
  '4-2-3-1': Object.freeze([
    slot('GK', 50, 93), slot('RB', 88, 74), slot('RCB', 63, 77), slot('LCB', 37, 77), slot('LB', 12, 74),
    slot('RDM', 64, 59), slot('LDM', 36, 59), slot('RW', 84, 36), slot('AM', 50, 41), slot('LW', 16, 36), slot('ST', 50, 15),
  ]),
  '4-3-3': Object.freeze([
    slot('GK', 50, 93), slot('RB', 88, 74), slot('RCB', 63, 77), slot('LCB', 37, 77), slot('LB', 12, 74),
    slot('RCM', 72, 55), slot('CM', 50, 61), slot('LCM', 28, 55), slot('RW', 82, 27), slot('ST', 50, 15), slot('LW', 18, 27),
  ]),
  '4-4-2': Object.freeze([
    slot('GK', 50, 93), slot('RB', 88, 74), slot('RCB', 63, 77), slot('LCB', 37, 77), slot('LB', 12, 74),
    slot('RM', 85, 51), slot('RCM', 62, 56), slot('LCM', 38, 56), slot('LM', 15, 51), slot('RST', 64, 20), slot('LST', 36, 20),
  ]),
  '4-1-4-1': Object.freeze([
    slot('GK', 50, 93), slot('RB', 88, 74), slot('RCB', 63, 77), slot('LCB', 37, 77), slot('LB', 12, 74), slot('DM', 50, 61),
    slot('RM', 86, 43), slot('RCM', 63, 48), slot('LCM', 37, 48), slot('LM', 14, 43), slot('ST', 50, 15),
  ]),
  '3-4-2-1': Object.freeze([
    slot('GK', 50, 93), slot('RCB', 75, 73), slot('CB', 50, 77), slot('LCB', 25, 73),
    slot('RWB', 88, 55), slot('RCM', 62, 59), slot('LCM', 38, 59), slot('LWB', 12, 55),
    slot('RAM', 68, 34), slot('LAM', 32, 34), slot('ST', 50, 14),
  ]),
  '3-4-3': Object.freeze([
    slot('GK', 50, 93), slot('RCB', 75, 73), slot('CB', 50, 77), slot('LCB', 25, 73),
    slot('RWB', 88, 55), slot('RCM', 62, 59), slot('LCM', 38, 59), slot('LWB', 12, 55),
    slot('RW', 82, 27), slot('ST', 50, 15), slot('LW', 18, 27),
  ]),
  '3-5-2': Object.freeze([
    slot('GK', 50, 93), slot('RCB', 75, 73), slot('CB', 50, 77), slot('LCB', 25, 73),
    slot('RWB', 89, 52), slot('RCM', 68, 57), slot('CM', 50, 62), slot('LCM', 32, 57), slot('LWB', 11, 52),
    slot('RST', 64, 19), slot('LST', 36, 19),
  ]),
  '5-2-3': Object.freeze([
    slot('GK', 50, 93), slot('RWB', 91, 66), slot('RCB', 70, 72), slot('CB', 50, 77), slot('LCB', 30, 72), slot('LWB', 9, 66),
    slot('RCM', 65, 53), slot('LCM', 35, 53), slot('RW', 82, 26), slot('ST', 50, 14), slot('LW', 18, 26),
  ]),
  '5-3-2': Object.freeze([
    slot('GK', 50, 93), slot('RWB', 91, 66), slot('RCB', 70, 72), slot('CB', 50, 77), slot('LCB', 30, 72), slot('LWB', 9, 66),
    slot('RCM', 70, 50), slot('CM', 50, 57), slot('LCM', 30, 50), slot('RST', 64, 18), slot('LST', 36, 18),
  ]),
  '5-4-1': Object.freeze([
    slot('GK', 50, 93), slot('RWB', 91, 66), slot('RCB', 70, 72), slot('CB', 50, 77), slot('LCB', 30, 72), slot('LWB', 9, 66),
    slot('RM', 85, 44), slot('RCM', 62, 50), slot('LCM', 38, 50), slot('LM', 15, 44), slot('ST', 50, 15),
  ]),
});

export const FORMATION_ORDER = Object.freeze(Object.keys(FORMATIONS));

const availabilityMap = Object.freeze({ a: 'available', d: 'doubt', i: 'injured', s: 'suspended' });
export const availabilityFor = (status) => availabilityMap[status] || 'available';

class StaleReviewedLineupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StaleReviewedLineupError';
  }
}

export function nailedPercent(minutes) {
  if (
    minutes === null ||
    minutes === undefined ||
    minutes === '' ||
    !Number.isFinite(Number(minutes))
  ) return null;
  return Math.round((Math.max(0, Math.min(90, Number(minutes))) / 90) * 100);
}

export function canFillSlot(player, slotKey) {
  return Boolean(player && SLOT_DEFINITIONS[slotKey]?.positions.includes(player.position));
}

function canFillReviewedSlot(player, slotKey) {
  if (!player || !SLOT_DEFINITIONS[slotKey]) return false;
  return slotKey === 'GK' ? player.position === 'GK' : player.position !== 'GK';
}

function fixturePrediction(player, gameweek) {
  const fixture = player.fixtures?.find((item) => Number(item.gameweek) === Number(gameweek));
  return {
    minutes: Number.isFinite(Number(fixture?.predictions?.minutes)) ? Number(fixture.predictions.minutes) : null,
    points: Number.isFinite(Number(fixture?.predictions?.points)) ? Number(fixture.predictions.points) : 0,
  };
}

function compareState(left, right) {
  if (!right) return 1;
  for (const key of ['minutes', 'points', 'preserved']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  const leftIds = left.assignments.filter(Boolean).map((item) => item.player.id).sort((a, b) => a - b).join(',');
  const rightIds = right.assignments.filter(Boolean).map((item) => item.player.id).sort((a, b) => a - b).join(',');
  return rightIds.localeCompare(leftIds, undefined, { numeric: true });
}

export function assignFormation(players, formation, gameweek, previousSlots = new Map()) {
  const slots = FORMATIONS[formation];
  if (!slots) throw new Error(`Unsupported formation: ${formation}.`);
  const eligible = players
    .filter((player) => !['injured', 'suspended'].includes(availabilityFor(player.status)))
    .map((player) => ({ ...player, prediction: fixturePrediction(player, gameweek) }))
    .sort((left, right) => right.prediction.minutes - left.prediction.minutes || right.prediction.points - left.prediction.points || left.id - right.id);
  let states = new Map([[0, { minutes: 0, points: 0, preserved: 0, assignments: Array(slots.length).fill(null) }]]);

  for (const player of eligible) {
    const next = new Map(states);
    for (const [mask, state] of states) {
      for (let index = 0; index < slots.length; index += 1) {
        if ((mask & (1 << index)) || !canFillSlot(player, slots[index].key)) continue;
        const assignments = state.assignments.slice();
        assignments[index] = { player, slot: slots[index].key };
        const candidate = {
          minutes: state.minutes + (player.prediction.minutes ?? 0),
          points: state.points + player.prediction.points,
          preserved: state.preserved + (previousSlots.get(player.id) === slots[index].key ? 1 : 0),
          assignments,
        };
        const nextMask = mask | (1 << index);
        if (compareState(candidate, next.get(nextMask)) > 0) next.set(nextMask, candidate);
      }
    }
    states = next;
  }

  const completed = states.get((1 << slots.length) - 1);
  if (!completed) throw new Error(`Could not fill formation ${formation}.`);
  return completed;
}

function publicPlayer(player, slotKey, gameweek) {
  const prediction = fixturePrediction(player, gameweek);
  const price = Number(player.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`${player.displayName} has an invalid price.`);
  return {
    playerId: player.id,
    displayName: player.displayName,
    slot: slotKey,
    price,
    nailedPercent: nailedPercent(prediction.minutes),
    availability: availabilityFor(player.status),
  };
}

function validateSources(sources, teamName) {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error(`${teamName} reviewed lineup needs at least one source.`);
  const urls = new Set();
  for (const source of sources) {
    if (!['official-lineup', 'official-preview', 'predicted-lineup', 'community-consensus'].includes(source?.type)) throw new Error(`${teamName} has an invalid source type.`);
    try { new URL(source.url); } catch { throw new Error(`${teamName} has an invalid source URL.`); }
    if (!Number.isFinite(Date.parse(source.checkedAt))) throw new Error(`${teamName} has an invalid source checkedAt value.`);
    urls.add(source.url);
  }
  return urls.size;
}

function validateReviewed(entry, team, players, gameweek) {
  const slots = FORMATIONS[entry.formation];
  if (!slots) throw new Error(`${team.name} has unsupported formation ${entry.formation}.`);
  if (!Array.isArray(entry.starters) || entry.starters.length !== 11) throw new Error(`${team.name} reviewed lineup must have 11 starters.`);
  const playerById = new Map(players.map((player) => [player.id, player]));
  const requiredSlots = new Set(slots.map((item) => item.key));
  const playerIds = new Set();
  const usedSlots = new Set();
  const starters = entry.starters.map((assignment) => {
    const player = playerById.get(Number(assignment.playerId));
    if (!player) throw new StaleReviewedLineupError(`${team.name} reviewed lineup contains an unknown or wrong-team player ${assignment.playerId}.`);
    if (playerIds.has(player.id)) throw new Error(`${team.name} reviewed lineup repeats player ${player.displayName}.`);
    if (!requiredSlots.has(assignment.slot) || usedSlots.has(assignment.slot)) throw new Error(`${team.name} reviewed lineup has an invalid or duplicate slot ${assignment.slot}.`);
    if (!canFillReviewedSlot(player, assignment.slot)) throw new Error(`${player.displayName} cannot fill ${assignment.slot} for ${team.name}.`);
    playerIds.add(player.id); usedSlots.add(assignment.slot);
    return publicPlayer(player, assignment.slot, gameweek);
  });
  if (usedSlots.size !== requiredSlots.size) throw new Error(`${team.name} reviewed lineup does not fill every formation slot.`);
  if (starters.filter((player) => player.slot === 'GK').length !== 1) throw new Error(`${team.name} reviewed lineup must contain one goalkeeper.`);
  return { starters, playerIds, sourceCount: validateSources(entry.sources, team.name) };
}

function selectContenders(entry, teamPlayers, starters, gameweek, formation) {
  const starterIds = new Set(starters.map((player) => player.playerId));
  const selected = [];
  const selectedIds = new Set();
  const playerById = new Map(teamPlayers.map((player) => [player.id, player]));
  const vulnerableSlots = starters.slice().sort((left, right) => (left.nailedPercent ?? -1) - (right.nailedPercent ?? -1)).map((player) => player.slot);

  for (const requested of entry?.contenders || []) {
    const player = playerById.get(Number(requested.playerId));
    if (!player) throw new StaleReviewedLineupError(`Reviewed lineup contains an unknown or wrong-team contender ${requested.playerId}.`);
    if (selectedIds.has(player.id)) throw new Error(`Invalid contender ${requested.playerId}.`);
    if (starterIds.has(player.id)) continue;
    if (!FORMATIONS[formation].some((item) => item.key === requested.targetSlot) || !canFillReviewedSlot(player, requested.targetSlot)) throw new Error(`${player.displayName} cannot contend for ${requested.targetSlot}.`);
    selected.push({ ...publicPlayer(player, requested.targetSlot, gameweek), targetSlot: requested.targetSlot });
    delete selected.at(-1).slot;
    selectedIds.add(player.id);
  }

  const candidates = teamPlayers
    .filter((player) => !starterIds.has(player.id) && !selectedIds.has(player.id) && !['injured', 'suspended'].includes(availabilityFor(player.status)))
    .map((player) => ({ player, prediction: fixturePrediction(player, gameweek) }))
    .sort((left, right) => (right.prediction.minutes ?? -1) - (left.prediction.minutes ?? -1) || right.prediction.points - left.prediction.points || left.player.id - right.player.id);
  for (const { player } of candidates) {
    if (selected.length >= 3) break;
    const targetSlot = vulnerableSlots.find((slotKey) => canFillSlot(player, slotKey));
    if (!targetSlot) continue;
    const contender = publicPlayer(player, targetSlot, gameweek);
    selected.push({ playerId: contender.playerId, displayName: contender.displayName, targetSlot, price: contender.price, nailedPercent: contender.nailedPercent, availability: contender.availability });
    selectedIds.add(player.id);
  }
  return selected.slice(0, 3);
}

function automaticTeam(team, players, entry, gameweek, generatedAt) {
  const previousSlots = new Map((entry?.starters || []).map((item) => [Number(item.playerId), item.slot]));
  const formationChoices = entry?.formation && FORMATIONS[entry.formation] ? [entry.formation, ...FORMATION_ORDER.filter((item) => item !== entry.formation)] : FORMATION_ORDER;
  let best = null;
  for (const formation of formationChoices) {
    try {
      const result = assignFormation(players, formation, gameweek, previousSlots);
      if (!best || compareState(result, best.result) > 0) best = { formation, result };
    } catch { /* Try the next supported formation. */ }
  }
  if (!best) throw new Error(`Could not build an automatic lineup for ${team.name}.`);
  const starters = best.result.assignments.map(({ player, slot: slotKey }) => publicPlayer(player, slotKey, gameweek));
  return {
    teamId: team.id, teamName: team.name, teamShortName: team.shortName, formation: best.formation,
    predictionStatus: 'automatic', updatedAt: generatedAt, sourceCount: 0, starters,
    contenders: selectContenders(null, players, starters, gameweek, best.formation),
  };
}

function reviewedTeam(team, players, entry, gameweek) {
  const { sourceCount } = validateReviewed(entry, team, players, gameweek);
  if (!Number.isFinite(Date.parse(entry.reviewedAt))) throw new Error(`${team.name} has an invalid reviewedAt value.`);
  const previousSlots = new Map(entry.starters.map((item) => [Number(item.playerId), item.slot]));
  const optimized = assignFormation(players, entry.formation, gameweek, previousSlots);
  const starters = optimized.assignments.map(({ player, slot: slotKey }) => publicPlayer(player, slotKey, gameweek));
  return {
    teamId: team.id, teamName: team.name, teamShortName: team.shortName, formation: entry.formation,
    predictionStatus: 'reviewed', updatedAt: entry.reviewedAt, sourceCount, starters,
    contenders: selectContenders(entry, players, starters, gameweek, entry.formation),
  };
}

export function buildLineupSnapshot(fixtureSnapshot, playerSnapshot, nameSnapshot, reviewSnapshot = null, generatedAt = new Date().toISOString()) {
  const gameweek = Number(nameSnapshot?.nextGameweek);
  if (!Number.isInteger(gameweek)) throw new Error('Next gameweek is invalid for lineup generation.');
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Lineup generatedAt must be a valid timestamp.');
  const teams = fixtureSnapshot?.teams || [];
  if (teams.length !== 20) throw new Error(`Expected 20 teams, found ${teams.length}.`);
  const teamById = new Map(teams.map((team) => [Number(team.id), team]));
  const matches = nameSnapshot?.matches || {};
  const players = (playerSnapshot?.players || []).map((player) => {
    const identity = matches[player.fullName];
    if (!identity) throw new Error(`Missing official identity for ${player.fullName}.`);
    return { ...player, id: Number(identity.id), teamId: Number(identity.teamId), displayName: identity.displayName || player.fullName };
  });
  const playersByTeam = new Map(teams.map((team) => [Number(team.id), players.filter((player) => player.teamId === Number(team.id))]));
  const reviewByTeam = new Map((reviewSnapshot?.teams || []).map((entry) => [Number(entry.teamId), entry]));
  const reviewIsCurrent = reviewSnapshot?.season === fixtureSnapshot?.meta?.fixtureSeason && Number(reviewSnapshot?.gameweek) === gameweek;

  const homeFixtures = (fixtureSnapshot.fixtures || []).filter((fixture) => Number(fixture.gameweek) === gameweek && fixture.venue === 'H');
  const gameweekEntries = (fixtureSnapshot.fixtures || []).filter((fixture) => Number(fixture.gameweek) === gameweek);
  if (homeFixtures.length !== 10 || gameweekEntries.length !== 20) throw new Error(`GW ${gameweek} must contain 10 fixtures and one fixture per team.`);
  const seenTeams = new Set();
  const publicFixtures = homeFixtures
    .sort((left, right) => Number(left.teamId) - Number(right.teamId))
    .map((fixture) => {
      const home = teamById.get(Number(fixture.teamId));
      const away = teamById.get(Number(fixture.opponentId));
      if (!home || !away || seenTeams.has(home.id) || seenTeams.has(away.id)) throw new Error(`GW ${gameweek} contains duplicate or unknown teams.`);
      seenTeams.add(home.id); seenTeams.add(away.id);
      const makeTeam = (team, venue) => {
        const entry = reviewByTeam.get(Number(team.id));
        let lineup;
        if (reviewIsCurrent && entry) {
          try {
            lineup = reviewedTeam(team, playersByTeam.get(Number(team.id)), entry, gameweek);
          } catch (error) {
            if (!(error instanceof StaleReviewedLineupError)) throw error;
            lineup = automaticTeam(team, playersByTeam.get(Number(team.id)), entry, gameweek, generatedAt);
          }
        } else {
          lineup = automaticTeam(team, playersByTeam.get(Number(team.id)), entry, gameweek, generatedAt);
        }
        return { ...lineup, venue };
      };
      return { homeTeamId: home.id, awayTeamId: away.id, teams: [makeTeam(home, 'H'), makeTeam(away, 'A')] };
    });
  if (seenTeams.size !== 20) throw new Error(`GW ${gameweek} lineup snapshot covers only ${seenTeams.size} teams.`);
  return { season: fixtureSnapshot.meta.fixtureSeason, gameweek, generatedAt, fixtures: publicFixtures };
}
