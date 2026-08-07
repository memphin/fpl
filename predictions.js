const PREFERENCES_KEY = 'fixture-lens-predictions-preferences-v2';
const POSITION_ORDER = ['GK', 'DEF', 'MID', 'FWD'];
const STAR_QUOTAS = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const state = {
  data: null,
  displayNames: {},
  nextGameweek: null,
  startGameweek: null,
  endGameweek: null,
  minPrice: null,
  maxPrice: null,
  search: '',
  position: '',
  club: '',
  sort: { column: 'total', direction: -1 },
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY));
    if (!saved) return;
    state.startGameweek = Number.isFinite(saved.startGameweek) ? saved.startGameweek : state.startGameweek;
    state.endGameweek = Number.isFinite(saved.endGameweek) ? saved.endGameweek : state.endGameweek;
    state.minPrice = Number.isFinite(saved.minPrice) ? saved.minPrice : state.minPrice;
    state.maxPrice = Number.isFinite(saved.maxPrice) ? saved.maxPrice : state.maxPrice;
    state.search = typeof saved.search === 'string' ? saved.search : '';
    state.position = typeof saved.position === 'string' ? saved.position : '';
    state.club = typeof saved.club === 'string' ? saved.club : '';
    if (saved.sort && typeof saved.sort.column === 'string' && [1, -1].includes(saved.sort.direction)) state.sort = saved.sort;
  } catch { /* Invalid saved preferences are safely ignored. */ }
}

function savePreferences() {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
    startGameweek: state.startGameweek,
    endGameweek: state.endGameweek,
    minPrice: state.minPrice,
    maxPrice: state.maxPrice,
    search: state.search,
    position: state.position,
    club: state.club,
    sort: state.sort,
  }));
}

function availableGameweeks() {
  const { min, max } = state.data.gameweeks;
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function visibleGameweeks() {
  return availableGameweeks().filter((gameweek) => gameweek >= state.startGameweek && gameweek <= state.endGameweek);
}

function defaultGameweekRange() {
  const gameweeks = availableGameweeks();
  const start = gameweeks.includes(state.nextGameweek) ? state.nextGameweek : gameweeks[0];
  return { start, end: Math.min(start + 5, gameweeks.at(-1)) };
}

function priceBounds() {
  const prices = state.data.players.map((player) => Number(player.price));
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function predictionFor(player, gameweek) {
  const fixture = player.fixtures.find((item) => item.gameweek === gameweek);
  return Number(fixture?.predictions?.points || 0);
}

function totalFor(player, gameweeks) {
  return gameweeks.reduce((total, gameweek) => total + predictionFor(player, gameweek), 0);
}

function displayNameFor(player) {
  if (state.displayNames[player.fullName]) return state.displayNames[player.fullName];
  const nameParts = player.fullName.trim().split(/\s+/);
  return nameParts.length < 3 ? player.fullName : nameParts.slice(0, 2).join(' ');
}

function valuePerMillionFor(player, gameweeks) {
  return player.price > 0 ? totalFor(player, gameweeks) / player.price : 0;
}

function greenCellStyle(points, maximum) {
  const intensity = Math.max(0, Math.min(1, points / maximum));
  const opacity = 0.08 + intensity * 0.72;
  return `background:rgba(11, 132, 78, ${opacity.toFixed(2)});color:${intensity > 0.58 ? '#fff' : '#123c52'}`;
}

function awardedPlayers(players, metric, quotas = STAR_QUOTAS) {
  const awarded = new Set();
  for (const position of POSITION_ORDER) {
    players
      .filter((player) => player.position === position)
      .sort((left, right) => metric(right) - metric(left) || left.fullName.localeCompare(right.fullName))
      .slice(0, quotas[position] || 0)
      .forEach((player) => awarded.add(player));
  }
  return awarded;
}

function awardedPlayersByPositionAndPrice(players, metric) {
  const awarded = new Set();
  for (const position of POSITION_ORDER) {
    const groups = new Map();
    for (const player of players.filter((candidate) => candidate.position === position)) {
      const price = Number(player.price).toFixed(1);
      groups.set(price, [...(groups.get(price) || []), player]);
    }
    for (const group of groups.values()) {
      group.sort((left, right) => metric(right) - metric(left) || left.fullName.localeCompare(right.fullName));
      awarded.add(group[0]);
    }
  }
  return awarded;
}

function awardStar(awarded, label) {
  return awarded ? ` <span class="award-star" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">★</span>` : '';
}

function sortedAndFilteredPlayers(gameweeks) {
  const search = state.search.trim().toLocaleLowerCase();
  const players = state.data.players.filter((player) =>
    (!search || player.fullName.toLocaleLowerCase().includes(search)) &&
    (!state.position || player.position === state.position) &&
    (!state.club || player.team.fullName === state.club) &&
    player.price >= state.minPrice && player.price <= state.maxPrice,
  );
  return players.sort((left, right) => {
    const sortValueFor = (player) => {
      if (state.sort.column === 'player') return player.fullName;
      if (state.sort.column === 'position') return player.position;
      if (state.sort.column === 'club') return player.team.fullName;
      if (state.sort.column === 'total') return totalFor(player, gameweeks);
      if (state.sort.column === 'price') return player.price;
      if (state.sort.column === 'selected') return Number(player.ownership || 0);
      if (state.sort.column === 'value') return valuePerMillionFor(player, gameweeks);
      return predictionFor(player, Number(state.sort.column));
    };
    const leftValue = sortValueFor(left), rightValue = sortValueFor(right);
    const comparison = typeof leftValue === 'string'
      ? leftValue.localeCompare(rightValue)
      : leftValue - rightValue;
    return state.sort.direction * comparison || left.fullName.localeCompare(right.fullName);
  });
}

function sortIcon(column) {
  if (state.sort.column !== column) return '↕';
  return state.sort.direction === 1 ? '↑' : '↓';
}

function sortAria(column, label) {
  if (state.sort.column !== column) return `Sort by ${label}.`;
  return `Sorted ${state.sort.direction === 1 ? 'ascending' : 'descending'} by ${label}. Activate to reverse.`;
}

function sortHeader(column, label, className = '') {
  return `<th class="${className}" scope="col"><span>${escapeHtml(label)}</span><button class="sort-toggle" type="button" data-sort="${escapeHtml(column)}" aria-label="${escapeHtml(sortAria(column, label))}" title="${escapeHtml(sortAria(column, label))}">${sortIcon(column)}</button></th>`;
}

function renderGrid() {
  const gameweeks = visibleGameweeks();
  const players = sortedAndFilteredPlayers(gameweeks);
  const awardCandidates = state.data.players;
  const awardsByGameweek = new Map(gameweeks.map((gameweek) => [gameweek, awardedPlayers(awardCandidates, (player) => predictionFor(player, gameweek))]));
  const totalAwards = awardedPlayers(awardCandidates, (player) => totalFor(player, gameweeks));
  const valueAwards = awardedPlayers(awardCandidates, (player) => valuePerMillionFor(player, gameweeks));
  const priceAwards = awardedPlayersByPositionAndPrice(awardCandidates, (player) => totalFor(player, gameweeks));
  const headers = [
    sortHeader('player', 'Player', 'prediction-player-heading'),
    sortHeader('position', 'Position', 'prediction-position-heading'),
    sortHeader('club', 'Club', 'prediction-club-heading'),
    sortHeader('price', 'Price', 'prediction-price-heading'),
    sortHeader('selected', 'Selected %', 'prediction-selected-heading'),
    ...gameweeks.map((gameweek) => sortHeader(String(gameweek), `GW ${gameweek}`)),
    sortHeader('total', 'Total'),
    sortHeader('value', 'Pts/£m'),
  ].join('');
  const rows = players.map((player) => {
    const total = totalFor(player, gameweeks);
    const value = valuePerMillionFor(player, gameweeks);
    const values = gameweeks.map((gameweek) => { const points = predictionFor(player, gameweek); return `<td class="prediction-points" style="${greenCellStyle(points, 10)}">${points.toFixed(1)}${awardStar(awardsByGameweek.get(gameweek).has(player), `Top ${player.position} predicted points for GW ${gameweek}`)}</td>`; }).join('');
    return `<tr><td class="prediction-player-cell" title="${escapeHtml(player.fullName)}" aria-label="${escapeHtml(player.fullName)}">${escapeHtml(displayNameFor(player))}</td><td class="prediction-position-cell">${escapeHtml(player.position)}</td><td class="prediction-club-cell">${escapeHtml(player.team.fullName)}</td><td class="prediction-price-cell">£${Number(player.price).toFixed(1)}m${awardStar(priceAwards.has(player), `Highest total predicted points among ${player.position} players at £${Number(player.price).toFixed(1)}m`)}</td><td class="prediction-selected-cell">${Number(player.ownership || 0).toFixed(1)}%</td>${values}<td class="prediction-total-cell" style="${greenCellStyle(total, gameweeks.length * 10)}">${total.toFixed(1)}${awardStar(totalAwards.has(player), `Top ${player.position} total predicted points`)}</td><td class="prediction-value-cell" style="${greenCellStyle(value, 10)}">${value.toFixed(1)}${awardStar(valueAwards.has(player), `Top ${player.position} predicted points per £m`)}</td></tr>`;
  }).join('');
  const table = `<table class="fixture-grid predictions-grid"><thead><tr>${headers}</tr></thead><tbody>${rows || `<tr><td class="empty-cell" colspan="${gameweeks.length + 7}">No players match these filters.</td></tr>`}</tbody></table>`;
  document.querySelector('#predictions-grid-wrap').innerHTML = table;
  document.querySelector('#prediction-summary').textContent = `${players.length} player${players.length === 1 ? '' : 's'} · GW ${state.startGameweek}–${state.endGameweek}`;
  document.querySelector('#prediction-gameweek-start').value = state.startGameweek;
  document.querySelector('#prediction-gameweek-end').value = state.endGameweek;
  document.querySelector('#prediction-gameweek-range-value').textContent = `${state.startGameweek}–${state.endGameweek}`;
  document.querySelector('#price-start').value = state.minPrice;
  document.querySelector('#price-end').value = state.maxPrice;
  document.querySelector('#price-range-value').textContent = `£${state.minPrice.toFixed(1)}m–£${state.maxPrice.toFixed(1)}m`;
}

function resetFilters() {
  const defaultRange = defaultGameweekRange();
  state.startGameweek = defaultRange.start;
  state.endGameweek = defaultRange.end;
  const prices = priceBounds();
  state.minPrice = prices.min;
  state.maxPrice = prices.max;
  state.search = '';
  state.position = '';
  state.club = '';
  state.sort = { column: 'total', direction: -1 };
  document.querySelector('#player-search').value = '';
  document.querySelector('#position-filter').value = '';
  document.querySelector('#club-filter').value = '';
  savePreferences();
  renderGrid();
}

function populateFilters() {
  const positions = [...new Set(state.data.players.map((player) => player.position))].sort((left, right) => POSITION_ORDER.indexOf(left) - POSITION_ORDER.indexOf(right));
  const clubs = [...new Set(state.data.players.map((player) => player.team.fullName))].sort((left, right) => left.localeCompare(right));
  document.querySelector('#position-filter').insertAdjacentHTML('beforeend', positions.map((position) => `<option value="${escapeHtml(position)}">${escapeHtml(position)}</option>`).join(''));
  document.querySelector('#club-filter').insertAdjacentHTML('beforeend', clubs.map((club) => `<option value="${escapeHtml(club)}">${escapeHtml(club)}</option>`).join(''));
}

async function init() {
  const [predictionResponse, namesResponse] = await Promise.all([fetch('data/ffh_players_compact.json'), fetch('data/fpl-player-display-names.json')]);
  if (!predictionResponse.ok || !namesResponse.ok) throw new Error('Could not load the bundled player predictions snapshot.');
  state.data = await predictionResponse.json();
  const displayNameSnapshot = await namesResponse.json();
  state.displayNames = displayNameSnapshot.names || {};
  state.nextGameweek = Number(displayNameSnapshot.nextGameweek);
  const gameweeks = availableGameweeks();
  loadPreferences();
  const defaultRange = defaultGameweekRange();
  state.startGameweek = Math.max(gameweeks[0], Math.min(state.startGameweek ?? defaultRange.start, gameweeks.at(-1)));
  state.endGameweek = Math.max(state.startGameweek, Math.min(state.endGameweek ?? defaultRange.end, gameweeks.at(-1)));
  const prices = priceBounds();
  state.minPrice = Math.max(prices.min, Math.min(state.minPrice ?? prices.min, prices.max));
  state.maxPrice = Math.max(state.minPrice, Math.min(state.maxPrice ?? prices.max, prices.max));
  populateFilters();
  document.querySelector('#player-search').value = state.search;
  document.querySelector('#position-filter').value = state.position;
  document.querySelector('#club-filter').value = state.club;
  for (const input of document.querySelectorAll('#prediction-gameweek-start, #prediction-gameweek-end')) {
    input.min = gameweeks[0];
    input.max = gameweeks.at(-1);
  }
  for (const input of document.querySelectorAll('#price-start, #price-end')) {
    input.min = prices.min;
    input.max = prices.max;
  }
  renderGrid();
  document.querySelector('#player-search').addEventListener('input', (event) => { state.search = event.target.value; savePreferences(); renderGrid(); });
  document.querySelector('#position-filter').addEventListener('change', (event) => { state.position = event.target.value; savePreferences(); renderGrid(); });
  document.querySelector('#club-filter').addEventListener('change', (event) => { state.club = event.target.value; savePreferences(); renderGrid(); });
  document.querySelector('#prediction-gameweek-start').addEventListener('input', (event) => { state.startGameweek = Math.min(Number(event.target.value), state.endGameweek); savePreferences(); renderGrid(); });
  document.querySelector('#prediction-gameweek-end').addEventListener('input', (event) => { state.endGameweek = Math.max(Number(event.target.value), state.startGameweek); savePreferences(); renderGrid(); });
  document.querySelector('#price-start').addEventListener('input', (event) => { state.minPrice = Math.min(Number(event.target.value), state.maxPrice); savePreferences(); renderGrid(); });
  document.querySelector('#price-end').addEventListener('input', (event) => { state.maxPrice = Math.max(Number(event.target.value), state.minPrice); savePreferences(); renderGrid(); });
  document.querySelector('#reset-prediction-filters').addEventListener('click', resetFilters);
  document.querySelector('#predictions-grid-wrap').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    const column = button.dataset.sort;
    state.sort = state.sort.column === column ? { column, direction: state.sort.direction * -1 } : { column, direction: column === 'player' || column === 'position' || column === 'club' ? 1 : -1 };
    savePreferences();
    renderGrid();
  });
}

init().catch((error) => { document.querySelector('#predictions-grid-wrap').innerHTML = `<p class="load-error">${escapeHtml(error.message)}</p>`; });
