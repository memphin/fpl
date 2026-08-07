import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTransfers, buildPlan, canSelectPlayer, CHIP_TYPES, chipIsAvailable, formationFor, horizonTotal, lineupTotals, moveBenchPlayer,
  replacePlayerInLineup, selectAutomaticLineup, setCaptainRole, swapLineupPlayers,
  transferSummary, VALID_FORMATIONS, validateLineup, validateSquad,
} from '../my-team-model.js';

const positions = { GK: 1, DEF: 2, MID: 3, FWD: 4 };
function player(id, position, points, teamId = id, price = 5) {
  return { id, position, price, displayName: `${position}${id}`, fullName: `${position}${id}`, team: { id: teamId, fullName: `Club ${teamId}` }, fixtures: points === null ? [] : [{ gameweek: 1, points }] };
}
function squad() {
  return [
    player(1, 'GK', 5), player(2, 'GK', 3),
    player(3, 'DEF', 9), player(4, 'DEF', 8), player(5, 'DEF', 7), player(6, 'DEF', 1), player(7, 'DEF', 0),
    player(8, 'MID', 10), player(9, 'MID', 6), player(10, 'MID', 5), player(11, 'MID', 4), player(12, 'MID', 3),
    player(13, 'FWD', 11), player(14, 'FWD', 2), player(15, 'FWD', 1),
  ];
}

test('validates FPL squad quotas, budget, clubs and duplicates', () => {
  assert.equal(validateSquad(squad()).valid, true);
  assert.equal(validateSquad(squad().slice(0, 14)).complete, false);
  const expensive = squad().map((item) => ({ ...item, price: 10 }));
  assert.match(validateSquad(expensive).errors.join(' '), /over budget/);
  const sameClub = squad().map((item, index) => index < 4 ? { ...item, team: { id: 99, fullName: 'Same Club' } } : item);
  assert.match(validateSquad(sameClub).errors.join(' '), /No more than 3/);
  assert.match(validateSquad([...squad().slice(0, 14), squad()[0]]).errors.join(' '), /more than once/);
});

test('reports why a candidate cannot be selected', () => {
  const current = squad().slice(0, 3);
  assert.match(canSelectPlayer(current, current[0]).reason, /already/);
  assert.match(canSelectPlayer(current, player(20, 'GK', 1)).reason, /slots are full/);
  assert.equal(canSelectPlayer(current, player(20, 'DEF', 1)).allowed, true);
});

test('selects the maximum legal XI with deterministic captain and bench', () => {
  const selectedSquad = squad();
  const lineup = selectAutomaticLineup(selectedSquad, 1);
  const byId = new Map(selectedSquad.map((item) => [item.id, item]));
  assert.equal(formationFor(lineup, byId), '3-5-2');
  assert.equal(lineup.captainId, 13);
  assert.equal(lineup.viceCaptainId, 8);
  assert.deepEqual(lineup.benchOutfieldIds, [6, 15, 7]);
  assert.deepEqual(lineupTotals(selectedSquad, lineup, 1), { base: 70, captainBonus: 11, benchBonus: 0, total: 81, bench: 5 });
});

test('applies free-transfer banking, hits and chip accounting', () => {
  assert.deepEqual(transferSummary(1, 3), { available: 1, count: 3, freeUsed: 1, hits: 2, hitCost: 8, bankAfter: 0, unlimited: false });
  assert.deepEqual(transferSummary(4, 0), { available: 4, count: 0, freeUsed: 0, hits: 0, hitCost: 0, bankAfter: 4, unlimited: false });
  assert.equal(transferSummary(2, 10, CHIP_TYPES.WILDCARD).hitCost, 0);
  assert.equal(transferSummary(2, 10, CHIP_TYPES.FREE_HIT).bankAfter, 2);
  assert.equal(chipIsAvailable(CHIP_TYPES.FREE_HIT, 1, {}), false);
  assert.equal(chipIsAvailable(CHIP_TYPES.WILDCARD, 4, { 2: CHIP_TYPES.WILDCARD }), false);
  assert.equal(chipIsAvailable(CHIP_TYPES.WILDCARD, 20, { 2: CHIP_TYPES.WILDCARD }), true);
});

test('derives permanent transfers and free-hit reversion across gameweeks', () => {
  const selectedSquad = squad();
  const replacement = player(16, 'FWD', 12);
  const plans = { 2: [{ outId: 14, inId: 16 }] };
  const permanent = buildPlan(selectedSquad, plans, {}, [1, 2, 3], 1, [...selectedSquad, replacement]);
  assert.ok(permanent.squads[2].some((item) => item.id === 16));
  assert.ok(permanent.squads[3].some((item) => item.id === 16));
  const freeHit = buildPlan(selectedSquad, plans, { 2: CHIP_TYPES.FREE_HIT }, [1, 2, 3], 1, [...selectedSquad, replacement]);
  assert.ok(freeHit.squads[2].some((item) => item.id === 16));
  assert.ok(freeHit.squads[3].some((item) => item.id === 14));
  assert.equal(freeHit.summaries[2].hitCost, 0);
  assert.ok(applyTransfers(selectedSquad, plans[2]).valid);
});

test('applies chip scoring to captain and bench totals', () => {
  const selectedSquad = squad();
  const lineup = selectAutomaticLineup(selectedSquad, 1);
  assert.equal(lineupTotals(selectedSquad, lineup, 1, CHIP_TYPES.TRIPLE_CAPTAIN).total, 92);
  assert.equal(lineupTotals(selectedSquad, lineup, 1, CHIP_TYPES.BENCH_BOOST).total, 86);
});

test('can select every legal FPL formation when it has the best projected score', () => {
  for (const [defenders, midfielders, forwards] of VALID_FORMATIONS) {
    let id = 1;
    const selectedSquad = [player(id++, 'GK', 5), player(id++, 'GK', 1)];
    for (const [position, quota, mandatory, wanted] of [['DEF', 5, 3, defenders], ['MID', 5, 2, midfielders], ['FWD', 3, 1, forwards]]) {
      for (let index = 0; index < quota; index += 1) selectedSquad.push(player(id++, position, index < mandatory ? 10 : index < wanted ? 9 : 0));
    }
    const lineup = selectAutomaticLineup(selectedSquad, 1);
    assert.equal(formationFor(lineup, new Map(selectedSquad.map((item) => [item.id, item]))), `${defenders}-${midfielders}-${forwards}`);
  }
});

test('uses player ID as the tie breaker and treats missing predictions as zero', () => {
  const selectedSquad = squad().map((item) => ({ ...item, fixtures: [{ gameweek: 1, points: 1 }] }));
  selectedSquad[0] = player(1, 'GK', null);
  const lineup = selectAutomaticLineup(selectedSquad, 1);
  assert.equal(lineup.captainId, 2);
  assert.equal(horizonTotal(selectedSquad[0], [1]), 0);
});

test('supports valid manual swaps and rejects invalid formations', () => {
  const selectedSquad = squad();
  const lineup = selectAutomaticLineup(selectedSquad, 1);
  const validSwap = swapLineupPlayers(lineup, selectedSquad, 12, 6);
  assert.equal(validSwap.ok, true);
  assert.equal(validSwap.lineup.mode, 'manual');
  const invalidSwap = swapLineupPlayers(lineup, selectedSquad, 5, 15);
  assert.equal(invalidSwap.ok, false);
  assert.match(invalidSwap.error, /invalid FPL formation/);
});

test('reorders the outfield bench and enforces captain roles', () => {
  const selectedSquad = squad();
  const lineup = selectAutomaticLineup(selectedSquad, 1);
  const moved = moveBenchPlayer(lineup, 15, -1);
  assert.deepEqual(moved.benchOutfieldIds, [15, 6, 7]);
  assert.equal(setCaptainRole(lineup, lineup.benchOutfieldIds[0], 'captain').ok, false);
  const changed = setCaptainRole(lineup, 8, 'captain');
  assert.equal(changed.lineup.captainId, 8);
  assert.notEqual(changed.lineup.captainId, changed.lineup.viceCaptainId);
});

test('replaces a player without losing lineup structure and repairs captaincy', () => {
  const selectedSquad = squad();
  const lineup = selectAutomaticLineup(selectedSquad, 1);
  const replacement = player(16, 'FWD', 12);
  const nextSquad = selectedSquad.map((item) => item.id === 13 ? replacement : item);
  const replaced = replacePlayerInLineup(lineup, nextSquad, 13, 16, 1);
  assert.ok(replaced.starters.includes(16));
  assert.equal(replaced.captainId, 16);
  assert.equal(validateLineup(replaced, nextSquad).valid, true);
});
