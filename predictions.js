const PREFERENCES_KEY = 'fixture-lens-predictions-preferences-v2';
const PREFERENCES_SCHEMA_VERSION = 3;
const POSITION_ORDER = ['GK', 'DEF', 'MID', 'FWD'];
const STAR_QUOTAS = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const METADATA_COLUMNS = [
  { key: 'player', label: 'Player', className: 'prediction-player-heading', width: 160 },
  { key: 'position', label: 'POS', className: 'prediction-position-heading', width: 46 },
  { key: 'club', label: 'Club', className: 'prediction-club-heading', width: 70 },
  { key: 'price', label: 'Price', className: 'prediction-price-heading', width: 52 },
  { key: 'selected', label: 'SEL%', className: 'prediction-selected-heading', width: 54 },
  { key: 'elite', label: 'ELITE%', className: 'prediction-elite-heading', width: 58 },
  { key: 'eliteDifference', label: 'DIFF %', className: 'prediction-elite-difference-heading', width: 62 },
];
const state = {
  data: null,
  nextGameweek: null,
  startGameweek: null,
  endGameweek: null,
  minPrice: null,
  maxPrice: null,
  search: '',
  position: '',
  club: '',
  showFixtures: true,
  showExpectedMinutes: false,
  hiddenPlayers: new Set(),
  hiddenGameweeks: new Set(),
  hiddenColumns: new Set(),
  sort: { column: 'total', direction: -1 },
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function optionalNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
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
    state.showFixtures = typeof saved.showFixtures === 'boolean' ? saved.showFixtures : true;
    state.showExpectedMinutes = saved.version === PREFERENCES_SCHEMA_VERSION && typeof saved.showExpectedMinutes === 'boolean' ? saved.showExpectedMinutes : false;
    state.hiddenPlayers = new Set(saved.hiddenPlayers || []);
    state.hiddenGameweeks = new Set(saved.hiddenGameweeks || []);
    state.hiddenColumns = new Set((saved.hiddenColumns || []).filter((column) => column !== 'player'));
    if (saved.sort && typeof saved.sort.column === 'string' && [1, -1].includes(saved.sort.direction)) state.sort = saved.sort;
  } catch { /* Invalid saved preferences are safely ignored. */ }
}

function savePreferences() {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
    version: PREFERENCES_SCHEMA_VERSION,
    startGameweek: state.startGameweek,
    endGameweek: state.endGameweek,
    minPrice: state.minPrice,
    maxPrice: state.maxPrice,
    search: state.search,
    position: state.position,
    club: state.club,
    showFixtures: state.showFixtures,
    showExpectedMinutes: state.showExpectedMinutes,
    hiddenPlayers: [...state.hiddenPlayers],
    hiddenGameweeks: [...state.hiddenGameweeks],
    hiddenColumns: [...state.hiddenColumns],
    sort: state.sort,
  }));
}

function availableGameweeks() {
  const { min, max } = state.data.gameweeks;
  const start = Math.max(min, state.nextGameweek || min);
  const end = Math.min(max, start + 9);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function visibleGameweeks() {
  return availableGameweeks().filter((gameweek) => gameweek >= state.startGameweek && gameweek <= state.endGameweek && !state.hiddenGameweeks.has(gameweek));
}

function columnVisible(column) {
  return column === 'player' || !state.hiddenColumns.has(column);
}

function metadataLeft(column) {
  const current = METADATA_COLUMNS.findIndex((item) => item.key === column);
  return METADATA_COLUMNS.slice(0, current).filter((item) => columnVisible(item.key)).reduce((left, item) => left + item.width, 0);
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
  return Number(fixture?.points || 0);
}

function fixtureFor(player, gameweek) {
  return player.fixtures.find((item) => item.gameweek === gameweek);
}

function totalFor(player, gameweeks) {
  return gameweeks.reduce((total, gameweek) => total + predictionFor(player, gameweek), 0);
}

function displayNameFor(player) {
  if (player.displayName) return player.displayName;
  const nameParts = player.fullName.trim().split(/\s+/);
  return nameParts.length < 3 ? player.fullName : nameParts.slice(0, 2).join(' ');
}

function valuePerMillionFor(player, gameweeks) {
  return player.price > 0 ? totalFor(player, gameweeks) / player.price : 0;
}

function greenCellStyle(points, maximum) {
  const intensity = maximum > 0 ? Math.max(0, Math.min(1, points / maximum)) : 0;
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
    !state.hiddenPlayers.has(player.fullName) &&
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
      if (state.sort.column === 'elite') return optionalNumber(player.eliteOwnership);
      if (state.sort.column === 'eliteDifference') return optionalNumber(player.eliteSelectionDifference);
      if (state.sort.column === 'value') return valuePerMillionFor(player, gameweeks);
      return predictionFor(player, Number(state.sort.column));
    };
    const leftValue = sortValueFor(left), rightValue = sortValueFor(right);
    if (leftValue === null && rightValue !== null) return 1;
    if (rightValue === null && leftValue !== null) return -1;
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

function sortHeader(column, label, className = '', style = '', canHide = true) {
  const hideButton = canHide ? `<button class="inline-toggle" type="button" data-hide-column="${escapeHtml(column)}" aria-label="Hide ${escapeHtml(label)} column" title="Hide ${escapeHtml(label)} column">−</button>` : '';
  return `<th class="${className}" scope="col" ${style}><span>${escapeHtml(label)}</span><button class="sort-toggle" type="button" data-sort="${escapeHtml(column)}" aria-label="${escapeHtml(sortAria(column, label))}" title="${escapeHtml(sortAria(column, label))}">${sortIcon(column)}</button>${hideButton}</th>`;
}

function gameweekHeader(gameweek) {
  const label = `gameweek ${gameweek}`;
  const aria = sortAria(String(gameweek), label);
  return `<th scope="col"><span>GW ${gameweek}</span><button class="sort-toggle" type="button" data-sort="${gameweek}" aria-label="${escapeHtml(aria)}" title="${escapeHtml(aria)}">${sortIcon(String(gameweek))}</button><button class="inline-toggle" type="button" data-hide-gameweek="${gameweek}" aria-label="Hide gameweek ${gameweek}" title="Hide gameweek ${gameweek}">−</button></th>`;
}

function renderRestoreStrip() {
  const hiddenGameweeks = [...state.hiddenGameweeks].sort((left, right) => left - right);
  const hiddenPlayers = state.data.players.filter((player) => state.hiddenPlayers.has(player.fullName));
  const hiddenColumns = [...state.hiddenColumns].map((column) => {
    const metadata = METADATA_COLUMNS.find((item) => item.key === column);
    const label = metadata?.label || (column === 'total' ? 'Total' : 'Pts/£m');
    return `<button class="restore-chip" type="button" data-show-column="${escapeHtml(column)}">+ ${escapeHtml(label)}</button>`;
  });
  const items = [
    ...hiddenColumns,
    ...hiddenGameweeks.map((gameweek) => `<button class="restore-chip" type="button" data-show-gameweek="${gameweek}">+ GW ${gameweek}</button>`),
    ...hiddenPlayers.map((player) => `<button class="restore-chip" type="button" data-show-player="${escapeHtml(player.fullName)}">+ ${escapeHtml(displayNameFor(player))}</button>`),
  ];
  document.querySelector('#prediction-restore-strip').innerHTML = items.length ? `<span>Show:</span>${items.join('')}` : '';
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
    ...METADATA_COLUMNS.filter((column) => columnVisible(column.key)).map((column) => sortHeader(column.key, column.label, column.className, `style="left:${metadataLeft(column.key)}px"`, column.key !== 'player')),
    ...gameweeks.map((gameweek) => gameweekHeader(gameweek)),
    columnVisible('total') && sortHeader('total', 'Total'),
    columnVisible('value') && sortHeader('value', 'Pts/£m'),
  ].filter(Boolean);
  const rows = players.map((player) => {
    const total = totalFor(player, gameweeks);
    const value = valuePerMillionFor(player, gameweeks);
    const values = gameweeks.map((gameweek) => {
      const fixture = fixtureFor(player, gameweek);
      const points = Number(fixture?.points || 0);
      const minutesValue = optionalNumber(fixture?.minutes);
      const minutes = minutesValue === null ? null : Math.round(minutesValue);
      const fixtureCode = fixture?.venue === 'H' ? fixture.opponentShort : fixture?.opponentShort?.toLowerCase();
      const opponent = state.showFixtures && fixtureCode ? `<span class="prediction-fixture" aria-label="${escapeHtml(fixture.opponentName || fixtureCode)} ${fixture.venue === 'H' ? 'at home' : 'away'}">${escapeHtml(fixtureCode)}</span>` : '';
      const expectedMinutes = minutes === null || !state.showExpectedMinutes ? '' : `<span class="prediction-minutes" aria-label="${minutes} expected minutes" title="${minutes} expected minutes">${minutes} xMins</span>`;
      return `<td class="prediction-points" style="${greenCellStyle(points, 10)}" aria-label="${points.toFixed(1)} predicted points${minutes === null ? '' : `, ${minutes} expected minutes`}">${opponent}${expectedMinutes}<span class="prediction-points-value">${points.toFixed(1)}${awardStar(awardsByGameweek.get(gameweek).has(player), `Top ${player.position} predicted points for GW ${gameweek}`)}</span></td>`;
    }).join('');
    const metadataCells = [
      columnVisible('player') && `<td class="prediction-player-cell" style="left:${metadataLeft('player')}px" title="${escapeHtml(player.fullName)}" aria-label="${escapeHtml(player.fullName)}"><span>${escapeHtml(displayNameFor(player))}</span><button class="inline-toggle" type="button" data-hide-player="${escapeHtml(player.fullName)}" aria-label="Hide ${escapeHtml(displayNameFor(player))}" title="Hide ${escapeHtml(displayNameFor(player))}">−</button></td>`,
      columnVisible('position') && `<td class="prediction-position-cell" style="left:${metadataLeft('position')}px">${escapeHtml(player.position)}</td>`,
      columnVisible('club') && `<td class="prediction-club-cell" style="left:${metadataLeft('club')}px">${escapeHtml(player.team.fullName)}</td>`,
      columnVisible('price') && `<td class="prediction-price-cell" style="left:${metadataLeft('price')}px">£${Number(player.price).toFixed(1)}m${awardStar(priceAwards.has(player), `Highest total predicted points among ${player.position} players at £${Number(player.price).toFixed(1)}m`)}</td>`,
      columnVisible('selected') && `<td class="prediction-selected-cell" style="left:${metadataLeft('selected')}px">${Number(player.ownership || 0).toFixed(1)}%</td>`,
      columnVisible('elite') && `<td class="prediction-elite-cell" style="left:${metadataLeft('elite')}px">${optionalNumber(player.eliteOwnership) === null ? '—' : `${optionalNumber(player.eliteOwnership).toFixed(1)}%`}</td>`,
      columnVisible('eliteDifference') && `<td class="prediction-elite-difference-cell" style="left:${metadataLeft('eliteDifference')}px">${optionalNumber(player.eliteSelectionDifference) === null ? '—' : `${optionalNumber(player.eliteSelectionDifference) > 0 ? '+' : ''}${optionalNumber(player.eliteSelectionDifference).toFixed(1)}%`}</td>`,
    ].filter(Boolean).join('');
    const metricCells = `${columnVisible('total') ? `<td class="prediction-total-cell" style="${greenCellStyle(total, gameweeks.length * 10)}">${total.toFixed(1)}${awardStar(totalAwards.has(player), `Top ${player.position} total predicted points`)}</td>` : ''}${columnVisible('value') ? `<td class="prediction-value-cell" style="${greenCellStyle(value, 10)}">${value.toFixed(1)}${awardStar(valueAwards.has(player), `Top ${player.position} predicted points per £m`)}</td>` : ''}`;
    return `<tr>${metadataCells}${values}${metricCells}</tr>`;
  }).join('');
  const table = headers.length ? `<table class="fixture-grid predictions-grid"><thead><tr>${headers.join('')}</tr></thead><tbody>${rows || `<tr><td class="empty-cell" colspan="${headers.length}">No players match these filters.</td></tr>`}</tbody></table>` : '<p class="empty-cell">All columns are hidden. Use the Show chips above to restore them.</p>';
  document.querySelector('#predictions-grid-wrap').innerHTML = table;
  document.querySelector('#prediction-summary').textContent = `${players.length} player${players.length === 1 ? '' : 's'} · GW ${state.startGameweek}–${state.endGameweek}`;
  document.querySelector('#prediction-gameweek-start').value = state.startGameweek;
  document.querySelector('#prediction-gameweek-end').value = state.endGameweek;
  document.querySelector('#prediction-gameweek-range-value').textContent = `${state.startGameweek}–${state.endGameweek}`;
  document.querySelector('#price-start').value = state.minPrice;
  document.querySelector('#price-end').value = state.maxPrice;
  document.querySelector('#price-range-value').textContent = `£${state.minPrice.toFixed(1)}m–£${state.maxPrice.toFixed(1)}m`;
  document.querySelector('#fixture-visibility').checked = state.showFixtures;
  document.querySelector('#minutes-visibility').checked = state.showExpectedMinutes;
  renderRestoreStrip();
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
  state.showFixtures = true;
  state.showExpectedMinutes = false;
  state.hiddenPlayers.clear();
  state.hiddenGameweeks.clear();
  state.hiddenColumns.clear();
  state.sort = { column: 'total', direction: -1 };
  document.querySelector('#player-search').value = '';
  document.querySelector('#position-filter').value = '';
  document.querySelector('#club-filter').value = '';
  document.querySelector('#fixture-visibility').checked = true;
  document.querySelector('#minutes-visibility').checked = false;
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
  const predictionResponse = await fetch('assets/players.json');
  if (!predictionResponse.ok) throw new Error('Could not load the player predictions.');
  state.data = await predictionResponse.json();
  state.nextGameweek = Number(state.data.nextGameweek);
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
  document.querySelector('#fixture-visibility').addEventListener('change', (event) => { state.showFixtures = event.target.checked; savePreferences(); renderGrid(); });
  document.querySelector('#minutes-visibility').addEventListener('change', (event) => { state.showExpectedMinutes = event.target.checked; savePreferences(); renderGrid(); });
  document.querySelector('#prediction-gameweek-start').addEventListener('input', (event) => { state.startGameweek = Math.min(Number(event.target.value), state.endGameweek); savePreferences(); renderGrid(); });
  document.querySelector('#prediction-gameweek-end').addEventListener('input', (event) => { state.endGameweek = Math.max(Number(event.target.value), state.startGameweek); savePreferences(); renderGrid(); });
  document.querySelector('#price-start').addEventListener('input', (event) => { state.minPrice = Math.min(Number(event.target.value), state.maxPrice); savePreferences(); renderGrid(); });
  document.querySelector('#price-end').addEventListener('input', (event) => { state.maxPrice = Math.max(Number(event.target.value), state.minPrice); savePreferences(); renderGrid(); });
  document.querySelector('#reset-prediction-filters').addEventListener('click', resetFilters);
  document.querySelector('#predictions-grid-wrap').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (button) {
      const column = button.dataset.sort;
      state.sort = state.sort.column === column ? { column, direction: state.sort.direction * -1 } : { column, direction: column === 'player' || column === 'position' || column === 'club' ? 1 : -1 };
    } else {
      const action = event.target.closest('button');
      if (!action) return;
      if (action.dataset.hideGameweek) {
        const gameweek = Number(action.dataset.hideGameweek);
        state.hiddenGameweeks.add(gameweek);
        if (state.sort.column === String(gameweek)) state.sort = { column: 'total', direction: -1 };
      }
      if (action.dataset.hidePlayer) state.hiddenPlayers.add(action.dataset.hidePlayer);
      if (action.dataset.hideColumn && action.dataset.hideColumn !== 'player') {
        state.hiddenColumns.add(action.dataset.hideColumn);
        if (state.sort.column === action.dataset.hideColumn) state.sort = { column: 'total', direction: -1 };
      }
    }
    savePreferences();
    renderGrid();
  });
  document.querySelector('#prediction-restore-strip').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.showGameweek) state.hiddenGameweeks.delete(Number(button.dataset.showGameweek));
    if (button.dataset.showPlayer) state.hiddenPlayers.delete(button.dataset.showPlayer);
    if (button.dataset.showColumn) state.hiddenColumns.delete(button.dataset.showColumn);
    savePreferences();
    renderGrid();
  });
}

init().catch((error) => { document.querySelector('#predictions-grid-wrap').innerHTML = `<p class="load-error">${escapeHtml(error.message)}</p>`; });
