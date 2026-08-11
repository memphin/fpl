import test from 'node:test';
import assert from 'node:assert/strict';
import { headToHead, metricOutcome, partitionItems, sanitizeSelection, toggleSelection } from '../comparison-model.js';

test('sanitizes comparison selections to unique valid integer IDs', () => {
  assert.deepEqual(sanitizeSelection(['2', 2, 99, 'nope', 1, 3], new Set([1, 2, 3])), [2, 1]);
  assert.deepEqual(sanitizeSelection(null, new Set([1, 2])), []);
});

test('adds and removes ordered selections without replacing a full pair', () => {
  assert.deepEqual(toggleSelection([], 7), { selection: [7], status: 'added', slot: 1 });
  assert.deepEqual(toggleSelection([7], 9), { selection: [7, 9], status: 'added', slot: 2 });
  assert.deepEqual(toggleSelection([7, 9], 11), { selection: [7, 9], status: 'full', slot: null });
  assert.deepEqual(toggleSelection([7, 9], 7), { selection: [9], status: 'removed', slot: 1 });
});

test('partitions selected items in slot order without duplicating them', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(partitionItems(items, [3, 1]), { selected: [items[2], items[0]], rest: [items[1]] });
});

test('evaluates higher, lower, neutral, tied and unavailable metrics', () => {
  assert.equal(metricOutcome(4, 3, 'higher'), 'left');
  assert.equal(metricOutcome(4, 3, 'lower'), 'right');
  assert.equal(metricOutcome(4, 4, 'higher'), 'tie');
  assert.equal(metricOutcome(4, 3, 'neutral'), 'neutral');
  assert.equal(metricOutcome(null, 3, 'higher'), 'unavailable');
});

test('counts comparable head-to-head values and skips missing entries', () => {
  assert.deepEqual(headToHead([4, 2, null, 5], [3, 2, 8, 6]), { left: 1, right: 1, ties: 1, compared: 3 });
  assert.deepEqual(headToHead([2, 5], [3, 4], 'lower'), { left: 1, right: 1, ties: 0, compared: 2 });
});
