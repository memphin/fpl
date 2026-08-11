import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePredictionSources } from '../scripts/fplreview-predictions.mjs';
import { assignFormation } from '../lineup-model.js';

function sourcePlayer(name, id, fixtures, eliteOwnership = 20) {
  return {
    ffh: { fullName: name, position: 'MID', fixtures: fixtures.map(({ gameweek, ffhPoints, ffhMinutes }) => ({ gameweek, predictions: { points: ffhPoints, minutes: ffhMinutes } })) },
    review: { id, eliteOwnership, fixtures: fixtures.filter(({ reviewPoints, reviewMinutes }) => reviewPoints !== undefined || reviewMinutes !== undefined).map(({ gameweek, reviewPoints, reviewMinutes }) => ({ gameweek, points: reviewPoints, minutes: reviewMinutes })) },
  };
}

test('averages points at full precision, treats zero as valid and prefers Review minutes', () => {
  const player = sourcePlayer('Alpha', 10, [
    { gameweek: 1, ffhPoints: 5.246, ffhMinutes: 60, reviewPoints: 0, reviewMinutes: 82 },
    { gameweek: 2, ffhPoints: 4, ffhMinutes: 70 },
  ]);
  const result = mergePredictionSources(
    { players: [player.ffh] },
    { matches: { Alpha: { id: 10 } } },
    { players: [player.review, { id: 99, eliteOwnership: 100, fixtures: [] }] },
  );
  assert.equal(result.snapshot.players[0].fixtures[0].predictions.points, 2.623);
  assert.equal(result.snapshot.players[0].fixtures[0].predictions.minutes, 82);
  assert.equal(result.snapshot.players[0].fixtures[1].predictions.points, 4);
  assert.equal(result.snapshot.players[0].fixtures[1].predictions.minutes, 70);
  assert.equal(result.snapshot.players[0].eliteOwnership, 20);
  assert.deepEqual(result.coverage, { matchedPlayers: 1, fallbackPlayers: 0, blendedFixtures: 1, fallbackFixtures: 1 });
});

test('falls back to FFH and publishes null elite ownership for an unmatched player', () => {
  const player = sourcePlayer('Beta', 11, [{ gameweek: 1, ffhPoints: 3, ffhMinutes: 55 }]);
  const result = mergePredictionSources({ players: [player.ffh] }, { matches: { Beta: { id: 11 } } }, { players: [] });
  assert.equal(result.snapshot.players[0].fixtures[0].predictions.points, 3);
  assert.equal(result.snapshot.players[0].fixtures[0].predictions.minutes, 55);
  assert.equal(result.snapshot.players[0].eliteOwnership, null);
  assert.deepEqual(result.coverage, { matchedPlayers: 0, fallbackPlayers: 1, blendedFixtures: 0, fallbackFixtures: 1 });
});

test('Review minutes change the minutes-first lineup selection', () => {
  const positions = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD', 'FWD'];
  const players = positions.map((position, index) => ({
    id: index + 1,
    fullName: `Player ${index + 1}`,
    displayName: `Player ${index + 1}`,
    position,
    status: 'a',
    fixtures: [{ gameweek: 1, predictions: { points: 4, minutes: index === 11 ? 70 : 90 } }],
  }));
  const names = { matches: Object.fromEntries(players.map((player) => [player.fullName, { id: player.id }])) };
  const review = { players: [
    { id: 11, eliteOwnership: 1, fixtures: [{ gameweek: 1, points: 4, minutes: 10 }] },
    { id: 12, eliteOwnership: 1, fixtures: [{ gameweek: 1, points: 4, minutes: 95 }] },
  ] };
  const { snapshot } = mergePredictionSources({ players }, names, review);
  const selected = assignFormation(snapshot.players, '4-3-3', 1).assignments.map((item) => item.player.id);
  assert.equal(selected.includes(11), false);
  assert.equal(selected.includes(12), true);
});
