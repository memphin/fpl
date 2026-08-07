import {
  BUDGET, CHIP_LABELS, CHIP_TYPES, POSITION_ORDER, POSITION_QUOTAS, buildPlan, canSelectPlayer,
  chipHalf, chipIsAvailable, formationFor, horizonTotal, lineupTotals, moveBenchPlayer, predictionFor,
  replaceAtGameweek, selectAutomaticLineup, setCaptainRole, swapLineupPlayers, validateLineup, validateSquad,
} from './my-team-model.js';

const STORAGE_KEY = 'fixture-lens-my-team-v1';
const state = {
  data: null,
  playerById: new Map(),
  initialSquadIds: [],
  horizonLength: 6,
  lineups: {},
  transferPlans: {},
  chips: {},
  startingFreeTransfers: 1,
  activeGameweek: null,
  replacingId: null,
  selectedSwap: null,
  filters: { search: '', position: '', club: '', minPrice: 0, maxPrice: 20, sort: 'points' },
};

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const firstGameweek = () => Math.max(state.data.gameweeks.min, Math.min(Number(state.data.nextGameweek) || state.data.gameweeks.min, state.data.gameweeks.max));
const visibleGameweeks = () => {
  const start = firstGameweek();
  return Array.from({ length: Math.min(state.horizonLength, state.data.gameweeks.max - start + 1) }, (_, index) => start + index);
};
const initialSquad = () => state.initialSquadIds.map((id) => state.playerById.get(id)).filter(Boolean);
const currentPlan = () => buildPlan(initialSquad(), state.transferPlans, state.chips, visibleGameweeks(), state.startingFreeTransfers, state.data.players);
const activeSquadIds = () => {
  const planned = currentPlan().squads[String(state.activeGameweek)];
  return (planned || initialSquad()).map((player) => typeof player === 'object' ? player.id : Number(player));
};
const squad = () => activeSquadIds().map((id) => state.playerById.get(id)).filter(Boolean);

function announce(message, kind = '') {
  const notice = document.querySelector('#team-notice');
  notice.textContent = message;
  notice.className = `team-notice${kind ? ` is-${kind}` : ''}`;
}

function serializableState() {
  return { version: 2, season: state.data.season, initialSquadIds: state.initialSquadIds, horizonLength: state.horizonLength, lineups: state.lineups, transferPlans: state.transferPlans, chips: state.chips, startingFreeTransfers: state.startingFreeTransfers };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableState())); }
  catch { announce('Your changes work for this visit, but this browser could not save them.', 'warning'); }
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || ![1, 2].includes(saved.version)) return;
    if (saved.season !== state.data.season) {
      localStorage.removeItem(STORAGE_KEY);
      announce(`Your saved squad was cleared because the player data is now for ${state.data.season}.`, 'warning');
      return;
    }
    const requestedIds = Array.isArray(saved.initialSquadIds || saved.squadIds) ? (saved.initialSquadIds || saved.squadIds).map(Number) : [];
    state.initialSquadIds = [...new Set(requestedIds.filter((id) => state.playerById.has(id)))].slice(0, 15);
    state.horizonLength = Math.max(4, Math.min(8, Number(saved.horizonLength) || 6));
    state.lineups = saved.lineups && typeof saved.lineups === 'object' ? saved.lineups : {};
    state.transferPlans = saved.transferPlans && typeof saved.transferPlans === 'object' ? saved.transferPlans : {};
    state.chips = saved.chips && typeof saved.chips === 'object' ? saved.chips : {};
    state.startingFreeTransfers = Math.max(0, Math.min(5, Number(saved.startingFreeTransfers ?? 1)));
    const missing = requestedIds.length - state.initialSquadIds.length;
    if (missing > 0) announce(`${missing} saved player${missing === 1 ? ' is' : 's are'} no longer available. Fill the open squad slot${missing === 1 ? '' : 's'}.`, 'warning');
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Ignore unavailable storage. */ }
    announce('The saved team could not be read and has been reset.', 'warning');
  }
}

function ensureLineups() {
  const selectedSquad = squad();
  const plan = currentPlan();
  if (!validateSquad(selectedSquad).valid) return;
  for (const gameweek of visibleGameweeks()) {
    const existing = state.lineups[gameweek];
    const gameweekSquad = plan.squads[String(gameweek)] || selectedSquad;
    if (!existing || !validateLineup(existing, gameweekSquad).valid) state.lineups[gameweek] = selectAutomaticLineup(gameweekSquad, gameweek);
  }
}

function renderOverview() {
  const validation = validateSquad(squad());
  const plan = currentPlan();
  const summary = plan.summaries[String(state.activeGameweek)] || { available: state.startingFreeTransfers, hits: 0, bankAfter: state.startingFreeTransfers };
  document.querySelector('#team-player-count').textContent = `${squad().length} / 15`;
  document.querySelector('#team-cost').textContent = `£${validation.cost.toFixed(1)}m`;
  document.querySelector('#team-remaining').textContent = `£${validation.remaining.toFixed(1)}m`;
  document.querySelector('#team-remaining').classList.toggle('is-negative', validation.remaining < 0);
  document.querySelector('#team-positions').textContent = POSITION_ORDER.map((position) => `${position} ${validation.counts[position]}/${POSITION_QUOTAS[position]}`).join(' · ');
  document.querySelector('#team-transfer-summary').textContent = `${summary.available} FT available · ${summary.hits ? `-${summary.hitCost}` : '0'} hits · ${summary.bankAfter} banked`;
  document.querySelector('#team-horizon').value = state.horizonLength;
  document.querySelector('#starting-free-transfers').value = state.startingFreeTransfers;
  const guidance = document.querySelector('#squad-guidance');
  guidance.textContent = validation.valid ? `GW ${state.activeGameweek} squad. Transfers are applied from the previous gameweek and follow the free-transfer bank and hit rules.` : `Fill ${15 - squad().length} more slot${15 - squad().length === 1 ? '' : 's'} within the £${BUDGET.toFixed(1)}m budget.`;
}

function squadCard(player, position, complete) {
  if (!player) return `<div class="squad-card is-empty"><span>${position}</span><strong>Empty slot</strong></div>`;
  const action = complete ? 'Change' : 'Remove';
  return `<article class="squad-card${state.replacingId === player.id ? ' is-replacing' : ''}">
    <span class="squad-card-position">${position}</span><strong title="${escapeHtml(player.fullName)}">${escapeHtml(player.displayName)}</strong>
    <small>${escapeHtml(player.team.fullName)} · £${player.price.toFixed(1)}m</small>
    <button type="button" data-squad-action="${complete ? 'replace' : 'remove'}" data-player-id="${player.id}" aria-label="${action} ${escapeHtml(player.displayName)}">${action}</button>
  </article>`;
}

function renderSquad() {
  const selectedSquad = squad();
  const complete = validateSquad(selectedSquad).valid;
  const byPosition = Object.fromEntries(POSITION_ORDER.map((position) => [position, selectedSquad.filter((player) => player.position === position)]));
  document.querySelector('#squad-groups').innerHTML = POSITION_ORDER.map((position) => {
    const cards = Array.from({ length: POSITION_QUOTAS[position] }, (_, index) => squadCard(byPosition[position][index], position, complete)).join('');
    return `<section class="squad-position-group"><h3>${position} <span>${byPosition[position].length}/${POSITION_QUOTAS[position]}</span></h3><div class="squad-position-cards">${cards}</div></section>`;
  }).join('');
  document.querySelector('#cancel-replacement').hidden = state.replacingId === null;
}

function playerSortValue(player, gameweeks) {
  if (state.filters.sort === 'name') return player.displayName;
  if (state.filters.sort === 'price') return player.price;
  if (state.filters.sort === 'ownership') return player.ownership;
  const total = horizonTotal(player, gameweeks);
  return state.filters.sort === 'value' ? total / player.price : total;
}

function renderPlayerPicker() {
  const gameweeks = visibleGameweeks();
  const query = state.filters.search.trim().toLocaleLowerCase();
  let players = state.data.players.filter((player) =>
    (!query || `${player.fullName} ${player.displayName} ${player.team.fullName}`.toLocaleLowerCase().includes(query)) &&
    (!state.filters.position || player.position === state.filters.position) &&
    (!state.filters.club || String(player.team.id) === state.filters.club) &&
    player.price >= state.filters.minPrice && player.price <= state.filters.maxPrice &&
    (!state.replacingId || player.position === state.playerById.get(state.replacingId)?.position)
  );
  players.sort((left, right) => {
    const leftValue = playerSortValue(left, gameweeks), rightValue = playerSortValue(right, gameweeks);
    if (typeof leftValue === 'string') return leftValue.localeCompare(rightValue) || left.id - right.id;
    return rightValue - leftValue || left.id - right.id;
  });
  const selectedSquad = squad();
  const rows = players.map((player) => {
    const eligibility = canSelectPlayer(selectedSquad, player, state.replacingId);
    const isSelected = activeSquadIds().includes(player.id) && player.id !== state.replacingId;
    const disabled = isSelected || !eligibility.allowed;
    const reason = isSelected ? 'Already selected' : eligibility.reason;
    const total = horizonTotal(player, gameweeks);
    return `<tr>
      <td class="picker-player"><strong title="${escapeHtml(player.fullName)}">${escapeHtml(player.displayName)}</strong><small>${escapeHtml(player.team.fullName)}</small></td>
      <td>${player.position}</td><td>£${player.price.toFixed(1)}m</td><td>${total.toFixed(1)}</td>
      <td><button class="picker-add" type="button" data-add-player="${player.id}" ${disabled ? 'disabled' : ''} title="${escapeHtml(reason)}" aria-label="${state.replacingId ? 'Replace with' : 'Add'} ${escapeHtml(player.displayName)}${reason ? `. ${escapeHtml(reason)}` : ''}">${state.replacingId ? 'Replace' : 'Add'}</button></td>
    </tr>`;
  }).join('');
  document.querySelector('#picker-summary').textContent = `${players.length} player${players.length === 1 ? '' : 's'} · ${gameweeks.length}-GW points`;
  document.querySelector('#player-picker-results').innerHTML = `<table class="player-picker-table"><thead><tr><th>Player</th><th>Pos</th><th>Price</th><th>Pts</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty-cell">No players match these filters.</td></tr>'}</tbody></table>`;
}

function gameweekLabel(player, gameweek) {
  const fixture = player.fixtures.find((item) => Number(item.gameweek) === Number(gameweek));
  if (!fixture) return 'Blank gameweek';
  const opponent = fixture.venue === 'A' ? fixture.opponentShort.toLowerCase() : fixture.opponentShort;
  return `${opponent} (${fixture.venue})`;
}

function lineupPlayerCard(player, gameweek, lineup, location, benchIndex = null) {
  const prediction = predictionFor(player, gameweek);
  const selected = state.selectedSwap?.id === player.id;
  const captain = lineup.captainId === player.id;
  const vice = lineup.viceCaptainId === player.id;
  const reorder = location === 'bench' && player.position !== 'GK' ? `<div class="bench-order-controls"><button type="button" data-bench-move="-1" data-player-id="${player.id}" ${benchIndex === 0 ? 'disabled' : ''} aria-label="Move ${escapeHtml(player.displayName)} earlier on bench">←</button><button type="button" data-bench-move="1" data-player-id="${player.id}" ${benchIndex === 2 ? 'disabled' : ''} aria-label="Move ${escapeHtml(player.displayName)} later on bench">→</button></div>` : '';
  const captainControls = location === 'starter' ? `<div class="captain-controls"><button type="button" data-role="captain" data-player-id="${player.id}" class="${captain ? 'is-active' : ''}" aria-label="Make ${escapeHtml(player.displayName)} captain">C</button><button type="button" data-role="vice" data-player-id="${player.id}" class="${vice ? 'is-active' : ''}" aria-label="Make ${escapeHtml(player.displayName)} vice-captain">V</button></div>` : '';
  return `<article class="lineup-player-card${selected ? ' is-selected' : ''}${captain ? ' is-captain' : ''}">
    ${captainControls}<button class="lineup-player-main" type="button" data-lineup-player="${player.id}" data-location="${location}" aria-pressed="${selected}" aria-label="${escapeHtml(player.displayName)}, ${prediction === null ? 'no prediction' : `${prediction.toFixed(1)} predicted points`}, ${location}. Select to substitute.">
      <span class="lineup-player-position">${player.position}</span><strong>${escapeHtml(player.displayName)}</strong>
      <small>${escapeHtml(gameweekLabel(player, gameweek))}</small><b>${prediction === null ? '—' : prediction.toFixed(1)}</b>
    </button>${reorder}
  </article>`;
}

function renderLineup() {
  const planner = document.querySelector('#lineup-planner');
  const selectedSquad = squad();
  const validation = validateSquad(selectedSquad);
  planner.hidden = !validation.valid;
  if (!validation.valid) return;
  ensureLineups();
  const gameweeks = visibleGameweeks();
  if (!gameweeks.includes(state.activeGameweek)) state.activeGameweek = gameweeks[0];
  const gameweek = state.activeGameweek;
  const lineup = state.lineups[gameweek];
  const playerById = state.playerById;
  const plan = currentPlan();
  const chip = plan.summaries[String(gameweek)]?.chip || null;
  const summary = plan.summaries[String(gameweek)] || { available: state.startingFreeTransfers, bankAfter: state.startingFreeTransfers, hits: 0, hitCost: 0, count: 0 };
  const totals = lineupTotals(selectedSquad, lineup, gameweek, chip);
  document.querySelector('#team-gameweek-tabs').innerHTML = gameweeks.map((gw) => {
    const gwSummary = plan.summaries[String(gw)] || {};
    const chipLabel = gwSummary.chip ? CHIP_LABELS[gwSummary.chip] : '';
    return `<button type="button" role="tab" data-gameweek="${gw}" aria-selected="${gw === gameweek}" class="${gw === gameweek ? 'is-active' : ''}">GW ${gw}<small>${gwSummary.count || 0} transfer${gwSummary.count === 1 ? '' : 's'}${gwSummary.hits ? ` · -${gwSummary.hitCost}` : ''}${chipLabel ? ` · ${chipLabel}` : ''}</small></button>`;
  }).join('');
  const moves = (plan.summaries[String(gameweek)]?.count ? (state.transferPlans[String(gameweek)] || []) : []);
  const transferText = moves.length ? ` · ${moves.map((move) => `${playerById.get(Number(move.outId))?.displayName || 'Player'} → ${playerById.get(Number(move.inId))?.displayName || 'Player'}`).join(', ')}` : '';
  document.querySelector('#lineup-description').innerHTML = `<strong>GW ${gameweek} · ${formationFor(lineup, playerById)}</strong><span>${lineup.mode === 'manual' ? 'Manually adjusted' : 'Automatically selected'} · ${summary.available} FT available · ${summary.bankAfter} banked${transferText}</span>`;
  const chipSelect = document.querySelector('#gameweek-chip');
  chipSelect.value = chip || '';
  for (const option of chipSelect.options) option.disabled = Boolean(option.value && !chipIsAvailable(option.value, gameweek, state.chips) && option.value !== chip);
  document.querySelector('#lineup-stats').innerHTML = `<div><span>GW transfers</span><strong>${summary.count}</strong></div><div><span>Hit cost</span><strong>${summary.hitCost ? `-${summary.hitCost}` : '0'}</strong></div><div class="is-total"><span>Projected total</span><strong>${totals.total.toFixed(1)}</strong></div><div><span>${chip === CHIP_TYPES.BENCH_BOOST ? 'Bench boost' : 'Bench'}</span><strong>${chip === CHIP_TYPES.BENCH_BOOST ? `+${totals.benchBonus.toFixed(1)}` : totals.bench.toFixed(1)}</strong></div>`;
  const starters = lineup.starters.map((id) => playerById.get(id));
  document.querySelector('#lineup-pitch').innerHTML = ['FWD', 'MID', 'DEF', 'GK'].map((position) => `<div class="pitch-row pitch-${position.toLowerCase()}">${starters.filter((player) => player.position === position).map((player) => lineupPlayerCard(player, gameweek, lineup, 'starter')).join('')}</div>`).join('');
  const bench = [playerById.get(lineup.benchGoalkeeperId), ...lineup.benchOutfieldIds.map((id) => playerById.get(id))];
  document.querySelector('#lineup-bench').innerHTML = bench.map((player, index) => lineupPlayerCard(player, gameweek, lineup, 'bench', index - 1)).join('');
}

function render() {
  ensureLineups();
  renderOverview();
  renderSquad();
  renderPlayerPicker();
  renderLineup();
}

function addOrReplacePlayer(id) {
  const player = state.playerById.get(id);
  const eligibility = canSelectPlayer(squad(), player, state.replacingId);
  if (!eligibility.allowed) { announce(eligibility.reason, 'error'); return; }
  if (state.replacingId !== null) {
    const oldId = state.replacingId;
    if (state.activeGameweek === firstGameweek()) {
      state.initialSquadIds = state.initialSquadIds.map((selectedId) => selectedId === oldId ? id : selectedId);
    } else {
      const result = replaceAtGameweek(state.initialSquadIds.map((playerId) => state.playerById.get(playerId)).filter(Boolean), state.transferPlans, state.activeGameweek, oldId, player, state.chips, visibleGameweeks(), state.startingFreeTransfers, state.data.players);
      if (!result.ok) { announce(result.error, 'error'); return; }
      state.transferPlans = result.transferPlans;
    }
    state.replacingId = null;
    announce(`${player.displayName} replaced the selected player for GW ${state.activeGameweek} and subsequent planned weeks.`, 'success');
  } else {
    state.initialSquadIds.push(id);
    announce(`${player.displayName} added to your squad.`, 'success');
  }
  ensureLineups();
  saveState();
  render();
}

function chooseSwap(id, location) {
  if (!state.selectedSwap) { state.selectedSwap = { id, location }; renderLineup(); return; }
  if (state.selectedSwap.id === id) { state.selectedSwap = null; renderLineup(); return; }
  if (state.selectedSwap.location === location) { state.selectedSwap = { id, location }; renderLineup(); return; }
  const starterId = location === 'starter' ? id : state.selectedSwap.id;
  const benchId = location === 'bench' ? id : state.selectedSwap.id;
  const result = swapLineupPlayers(state.lineups[state.activeGameweek], squad(), starterId, benchId);
  state.selectedSwap = null;
  if (!result.ok) { announce(result.error, 'error'); renderLineup(); return; }
  state.lineups[state.activeGameweek] = result.lineup;
  announce('Lineup updated.', 'success');
  saveState();
  render();
}

function bindEvents() {
  document.querySelector('#player-picker-results').addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-player]');
    if (button && !button.disabled) addOrReplacePlayer(Number(button.dataset.addPlayer));
  });
  document.querySelector('#squad-groups').addEventListener('click', (event) => {
    const button = event.target.closest('[data-squad-action]'); if (!button) return;
    const id = Number(button.dataset.playerId);
    if (button.dataset.squadAction === 'remove') {
      const removed = state.playerById.get(id);
      state.initialSquadIds = state.initialSquadIds.filter((playerId) => playerId !== id);
      state.lineups = {};
      announce(`${removed.displayName} removed from your squad.`, 'success');
    } else {
      state.replacingId = id;
      state.filters.position = state.playerById.get(id).position;
      document.querySelector('#team-position-filter').value = state.filters.position;
      document.querySelector('#player-picker').open = true;
      announce(`Choose another ${state.filters.position} to replace ${state.playerById.get(id).displayName}.`);
    }
    saveState(); render();
  });
  document.querySelector('#cancel-replacement').addEventListener('click', () => { state.replacingId = null; state.filters.position = ''; document.querySelector('#team-position-filter').value = ''; render(); });
  const filterBindings = [
    ['#team-player-search', 'input', 'search'], ['#team-position-filter', 'change', 'position'], ['#team-club-filter', 'change', 'club'],
    ['#team-min-price', 'input', 'minPrice'], ['#team-max-price', 'input', 'maxPrice'], ['#team-player-sort', 'change', 'sort'],
  ];
  for (const [selector, eventName, key] of filterBindings) document.querySelector(selector).addEventListener(eventName, (event) => { state.filters[key] = ['minPrice', 'maxPrice'].includes(key) ? Number(event.target.value) : event.target.value; renderPlayerPicker(); });
  document.querySelector('#team-horizon').addEventListener('change', (event) => {
    state.horizonLength = Number(event.target.value); ensureLineups(); saveState(); render();
  });
  document.querySelector('#starting-free-transfers').addEventListener('change', (event) => {
    state.startingFreeTransfers = Math.max(0, Math.min(5, Number(event.target.value))); ensureLineups(); saveState(); render();
  });
  document.querySelector('#team-gameweek-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-gameweek]'); if (!button) return;
    state.activeGameweek = Number(button.dataset.gameweek); state.selectedSwap = null; state.replacingId = null; render();
  });
  document.querySelector('#gameweek-chip').addEventListener('change', (event) => {
    const chip = event.target.value || null;
    if (chip && !chipIsAvailable(chip, state.activeGameweek, state.chips)) { announce('That chip is already used in this half of the season or is unavailable in this gameweek.', 'error'); renderLineup(); return; }
    if (chip) state.chips[state.activeGameweek] = chip; else delete state.chips[state.activeGameweek];
    ensureLineups(); saveState(); announce(chip ? `${CHIP_LABELS[chip]} selected for GW ${state.activeGameweek}.` : `Chip removed from GW ${state.activeGameweek}.`, 'success'); render();
  });
  document.querySelector('#auto-pick-gameweek').addEventListener('click', () => { const gameweekSquad = currentPlan().squads[String(state.activeGameweek)] || squad(); state.lineups[state.activeGameweek] = selectAutomaticLineup(gameweekSquad, state.activeGameweek); state.selectedSwap = null; announce(`GW ${state.activeGameweek} automatically selected.`, 'success'); saveState(); render(); });
  document.querySelector('#auto-pick-all').addEventListener('click', () => { const plan = currentPlan(); for (const gameweek of visibleGameweeks()) state.lineups[gameweek] = selectAutomaticLineup(plan.squads[String(gameweek)] || squad(), gameweek); state.selectedSwap = null; announce('All visible gameweeks automatically selected.', 'success'); saveState(); render(); });
  for (const selector of ['#lineup-pitch', '#lineup-bench']) {
    document.querySelector(selector).addEventListener('click', (event) => {
      const roleButton = event.target.closest('[data-role]');
      if (roleButton) {
        const result = setCaptainRole(state.lineups[state.activeGameweek], Number(roleButton.dataset.playerId), roleButton.dataset.role);
        if (result.ok) { state.lineups[state.activeGameweek] = result.lineup; announce(`${roleButton.dataset.role === 'captain' ? 'Captain' : 'Vice-captain'} updated.`, 'success'); saveState(); render(); }
        return;
      }
      const moveButton = event.target.closest('[data-bench-move]');
      if (moveButton) { state.lineups[state.activeGameweek] = moveBenchPlayer(state.lineups[state.activeGameweek], Number(moveButton.dataset.playerId), Number(moveButton.dataset.benchMove)); announce('Bench order updated.', 'success'); saveState(); render(); return; }
      const card = event.target.closest('[data-lineup-player]');
      if (card) chooseSwap(Number(card.dataset.lineupPlayer), card.dataset.location);
    });
  }
  document.querySelector('#reset-team').addEventListener('click', () => {
    if (!state.initialSquadIds.length || confirm('Reset your squad, transfers, chips and every saved gameweek lineup?')) {
      state.initialSquadIds = []; state.lineups = {}; state.transferPlans = {}; state.chips = {}; state.startingFreeTransfers = 1; state.replacingId = null; state.selectedSwap = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* Ignore unavailable storage. */ }
      announce('My Team has been reset.', 'success'); render();
    }
  });
}

async function init() {
  const response = await fetch('assets/players.json');
  if (!response.ok) throw new Error('Could not load the player predictions.');
  state.data = await response.json();
  state.playerById = new Map(state.data.players.map((player) => [Number(player.id), player]));
  const prices = state.data.players.map((player) => player.price);
  state.filters.minPrice = Math.floor(Math.min(...prices) * 2) / 2;
  state.filters.maxPrice = Math.ceil(Math.max(...prices) * 2) / 2;
  document.querySelector('#team-min-price').value = state.filters.minPrice;
  document.querySelector('#team-max-price').value = state.filters.maxPrice;
  const clubs = [...new Map(state.data.players.map((player) => [player.team.id, player.team])).values()].sort((left, right) => left.fullName.localeCompare(right.fullName));
  document.querySelector('#team-club-filter').insertAdjacentHTML('beforeend', clubs.map((club) => `<option value="${club.id}">${escapeHtml(club.fullName)}</option>`).join(''));
  loadState();
  ensureLineups();
  state.activeGameweek = visibleGameweeks()[0];
  bindEvents();
  render();
}

init().catch((error) => { document.querySelector('#team-notice').textContent = error.message; document.querySelector('#team-notice').className = 'team-notice is-error'; });
