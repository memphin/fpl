export const COMPARISON_LIMIT = 2;

export function sanitizeSelection(selection, validIds, limit = COMPARISON_LIMIT) {
  const allowed = validIds instanceof Set ? validIds : new Set(validIds);
  const sanitized = [];
  for (const value of Array.isArray(selection) ? selection : []) {
    const id = Number(value);
    if (!Number.isInteger(id) || !allowed.has(id) || sanitized.includes(id)) continue;
    sanitized.push(id);
    if (sanitized.length === limit) break;
  }
  return sanitized;
}

export function toggleSelection(selection, value, limit = COMPARISON_LIMIT) {
  const ids = Array.isArray(selection) ? [...selection] : [];
  const id = Number(value);
  const currentIndex = ids.indexOf(id);
  if (currentIndex !== -1) {
    ids.splice(currentIndex, 1);
    return { selection: ids, status: 'removed', slot: currentIndex + 1 };
  }
  if (!Number.isInteger(id) || ids.length >= limit) return { selection: ids, status: 'full', slot: null };
  ids.push(id);
  return { selection: ids, status: 'added', slot: ids.length };
}

export function partitionItems(items, selection, idFor = (item) => item.id) {
  const byId = new Map(items.map((item) => [Number(idFor(item)), item]));
  const selected = selection.map((id) => byId.get(Number(id))).filter(Boolean);
  const selectedIds = new Set(selected.map((item) => Number(idFor(item))));
  return { selected, rest: items.filter((item) => !selectedIds.has(Number(idFor(item)))) };
}

export function metricOutcome(left, right, direction = 'neutral') {
  if (direction === 'neutral') return 'neutral';
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 'unavailable';
  if (left === right) return 'tie';
  const leftWins = direction === 'lower' ? left < right : left > right;
  return leftWins ? 'left' : 'right';
}

export function headToHead(leftValues, rightValues, direction = 'higher') {
  const result = { left: 0, right: 0, ties: 0, compared: 0 };
  const length = Math.min(leftValues.length, rightValues.length);
  for (let index = 0; index < length; index += 1) {
    const outcome = metricOutcome(leftValues[index], rightValues[index], direction);
    if (outcome === 'unavailable' || outcome === 'neutral') continue;
    result.compared += 1;
    if (outcome === 'left') result.left += 1;
    else if (outcome === 'right') result.right += 1;
    else result.ties += 1;
  }
  return result;
}
