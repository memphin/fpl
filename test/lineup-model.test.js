import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assignFormation, buildLineupSnapshot, canFillSlot, FORMATIONS, nailedPercent } from '../lineup-model.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

function player(id, position, minutes, points = minutes / 20, status = 'a') {
  return { id, position, status, displayName: `Player ${id}`, fixtures: [{ gameweek: 1, predictions: { minutes, points } }] };
}

test('formation registry defines eleven unique in-bounds tactical slots', () => {
  assert.equal(Object.keys(FORMATIONS).length, 10);
  for (const [formation, slots] of Object.entries(FORMATIONS)) {
    assert.equal(slots.length, 11, formation);
    assert.equal(new Set(slots.map((slot) => slot.key)).size, 11, formation);
    for (const slot of slots) {
      assert.ok(slot.x >= 0 && slot.x <= 100, `${formation} ${slot.key} x`);
      assert.ok(slot.y >= 0 && slot.y <= 100, `${formation} ${slot.key} y`);
    }
  }
});

test('calculates and clamps the minutes-based nailed estimate', () => {
  assert.equal(nailedPercent(80), 89);
  assert.equal(nailedPercent(90), 100);
  assert.equal(nailedPercent(120), 100);
  assert.equal(nailedPercent(-5), 0);
  assert.equal(nailedPercent(null), null);
  assert.equal(nailedPercent(undefined), null);
});

test('slot eligibility supports tactical flexibility without allowing a non-goalkeeper in goal', () => {
  assert.equal(canFillSlot(player(1, 'DEF', 90), 'RWB'), true);
  assert.equal(canFillSlot(player(2, 'MID', 90), 'RWB'), true);
  assert.equal(canFillSlot(player(3, 'FWD', 90), 'RW'), true);
  assert.equal(canFillSlot(player(4, 'MID', 90), 'CB'), false);
  assert.equal(canFillSlot(player(5, 'DEF', 90), 'GK'), false);
});

test('automatic assignment maximizes minutes, excludes unavailable players, and breaks ties by ID', () => {
  const players = [
    player(1, 'GK', 90), player(2, 'DEF', 90), player(3, 'DEF', 90), player(4, 'DEF', 90), player(5, 'DEF', 90),
    player(6, 'MID', 90), player(7, 'MID', 90), player(8, 'MID', 90), player(9, 'FWD', 90), player(10, 'FWD', 90), player(11, 'FWD', 90),
    player(12, 'DEF', 100, 20, 'i'), player(13, 'FWD', 90),
  ];
  const result = assignFormation(players, '4-3-3', 1);
  const ids = result.assignments.map((item) => item.player.id);
  assert.equal(ids.includes(12), false);
  assert.equal(ids.includes(13), false, 'lower player ID wins an otherwise identical tie');
  assert.deepEqual(ids.sort((a, b) => a - b), Array.from({ length: 11 }, (_, index) => index + 1));
});

test('real editorial snapshot builds 20 reviewed teams and sanitized public values', async () => {
  const [fixtures, players, names, review] = await Promise.all([
    readJson('../data/fdr-data.json'), readJson('../data/ffh_players_compact.json'),
    readJson('../data/fpl-player-display-names.json'), readJson('../data/predicted-lineups.json'),
  ]);
  const output = buildLineupSnapshot(fixtures, players, names, review, '2026-08-10T14:30:00Z');
  const teams = output.fixtures.flatMap((fixture) => fixture.teams);
  assert.equal(output.fixtures.length, 10);
  assert.equal(new Set(teams.map((team) => team.teamId)).size, 20);
  assert.equal(teams.filter((team) => team.predictionStatus === 'reviewed').length, 20);
  assert.ok(teams.every((team) => team.starters.length === 11 && team.contenders.length === 3 && team.sourceCount === 2));
  assert.ok(teams.every((team) => [...team.starters, ...team.contenders].every((player) => Number.isFinite(player.price) && player.price > 0)));
  for (const team of teams) {
    const starterBySlot = new Map(team.starters.map((player) => [player.slot, player]));
    for (const contender of team.contenders) {
      const starter = starterBySlot.get(contender.targetSlot);
      assert.ok((starter.nailedPercent ?? -1) >= (contender.nailedPercent ?? -1), `${team.teamName}: ${contender.displayName} should start ahead of ${starter.displayName}`);
    }
  }
  const arsenal = teams.find((team) => team.teamName === 'Arsenal');
  assert.ok(arsenal.starters.some((player) => player.displayName === 'Nwaneri' && player.nailedPercent === 72));
  assert.equal(arsenal.starters.some((player) => player.displayName === 'Saka' && player.nailedPercent === 17), false, 'higher nailed estimate is promoted into the reviewed XI');
  assert.doesNotMatch(JSON.stringify(output), /fantasyfootballscout|fpl\.team|projectedMinutes|"minutes"/i);
});

test('stale reviews and roster drift become automatic while malformed current reviews fail', async () => {
  const [fixtures, players, names, review] = await Promise.all([
    readJson('../data/fdr-data.json'), readJson('../data/ffh_players_compact.json'),
    readJson('../data/fpl-player-display-names.json'), readJson('../data/predicted-lineups.json'),
  ]);
  const stale = structuredClone(review);
  stale.gameweek = 2;
  const automatic = buildLineupSnapshot(fixtures, players, names, stale, '2026-08-10T14:30:00Z').fixtures.flatMap((fixture) => fixture.teams);
  assert.equal(automatic.filter((team) => team.predictionStatus === 'automatic').length, 20);

  const transferred = structuredClone(names);
  transferred.matches['Saša Lukić'].teamId = 12;
  const rosterChanged = buildLineupSnapshot(fixtures, players, transferred, review, '2026-08-11T05:00:00Z').fixtures.flatMap((fixture) => fixture.teams);
  assert.equal(rosterChanged.find((team) => team.teamName === 'Fulham').predictionStatus, 'automatic');
  assert.equal(rosterChanged.filter((team) => team.predictionStatus === 'reviewed').length, 19);
  assert.ok(rosterChanged.every((team) => team.starters.length === 11 && team.contenders.length === 3));

  const malformed = structuredClone(review);
  malformed.teams[0].starters.pop();
  assert.throws(() => buildLineupSnapshot(fixtures, players, names, malformed), /must have 11 starters/);
});
