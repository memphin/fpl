const STORAGE_KEY = 'fixture-lens-preferences-v1';
const state = { data: null, mode: 'overall', hiddenClubs: new Set(), hiddenGameweeks: new Set(), startGameweek: null, endGameweek: null, adjustments: {}, sort: { target: null, direction: 1 } };
const metricLabel = { overall: 'Overall', attack: 'Attack', defence: 'Defence' };

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) { state.mode = saved.mode || state.mode; state.hiddenClubs = new Set(saved.hiddenClubs || []); state.hiddenGameweeks = new Set(saved.hiddenGameweeks || []); state.startGameweek = saved.startGameweek || state.startGameweek; state.endGameweek = saved.endGameweek || state.endGameweek; state.adjustments = saved.adjustments || {}; }
  } catch { /* Invalid saved preferences are safely ignored. */ }
}
function savePreferences() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: state.mode, hiddenClubs: [...state.hiddenClubs], hiddenGameweeks: [...state.hiddenGameweeks], startGameweek: state.startGameweek, endGameweek: state.endGameweek, adjustments: state.adjustments })); }
function ratingColor(value) { const position = Math.max(0, Math.min(1, (value - 2.5) / 5)); const hue = 132 - position * 132; return `hsl(${hue} 88% 77%)`; }
function ratingTextColor(value) { return value >= 6 ? '#551010' : '#102d19'; }
function visibleTeams() { return state.data.teams.filter((team) => !state.hiddenClubs.has(team.id)); }
function visibleGameweeks() { return state.data.gameweeks.filter((gw) => gw >= state.startGameweek && gw <= state.endGameweek && !state.hiddenGameweeks.has(gw)); }
function defaultGameweekRange() {
  const gameweeks = state.data.gameweeks;
  const start = gameweeks.includes(state.data.nextGameweek) ? state.data.nextGameweek : gameweeks[0];
  return { start, end: Math.min(start + 5, gameweeks.at(-1)) };
}
function sortIcon(target) { return state.sort.target !== target ? '↕' : state.sort.direction === 1 ? '↑' : '↓'; }
function sortAria(target, label) { return state.sort.target === target ? `Sorted ${state.sort.direction === 1 ? 'easiest to hardest' : 'hardest to easiest'} by ${label}. Activate to reverse.` : `Sort teams by ${label}, easiest to hardest.`; }
function multiplier(teamId, kind) { return Number(state.adjustments[teamId]?.[kind] || 1); }
function calculatedFixtures() {
  const teams = new Map(state.data.teams.map((team) => [team.id, team]));
  const raw = state.data.fixtures.map((fixture) => {
    const team = teams.get(fixture.teamId), opponent = teams.get(fixture.opponentId);
    const teamVenue = fixture.venue === 'H' ? 'home' : 'away';
    const opponentVenue = fixture.venue === 'H' ? 'away' : 'home';
    const attack = (team.stats[teamVenue].scored * multiplier(team.id, 'scoring') + opponent.stats[opponentVenue].conceded * multiplier(opponent.id, 'conceding')) / 2;
    const defence = (team.stats[teamVenue].conceded * multiplier(team.id, 'conceding') + opponent.stats[opponentVenue].scored * multiplier(opponent.id, 'scoring')) / 2;
    return { fixture, attack, defence };
  });
  const attackValues = raw.map((item) => item.attack), defenceValues = raw.map((item) => item.defence);
  const toRating = (value, values, inverse = false) => { const min = Math.min(...values), max = Math.max(...values), normal = max === min ? .5 : (value - min) / (max - min); return +(1 + (inverse ? 1 - normal : normal) * 9).toFixed(1); };
  return raw.map(({ fixture, attack, defence }) => { const attackRating = toRating(attack, attackValues, true), defenceRating = toRating(defence, defenceValues); return { ...fixture, averages: { attack: +attack.toFixed(2), defence: +defence.toFixed(2) }, ratings: { attack: attackRating, defence: defenceRating, overall: +((attackRating + defenceRating) / 2).toFixed(1) } }; });
}
function renderAdjustments() {
  document.querySelector('#adjustments-list').innerHTML = state.data.teams.map((team) => {
    const scoring = multiplier(team.id, 'scoring').toFixed(2), conceding = multiplier(team.id, 'conceding').toFixed(2);
    return `<div class="adjustment-row"><strong>${team.name}</strong><label>Scoring <output>${scoring}</output><input type="range" min="0.75" max="1.25" step="0.05" value="${scoring}" data-adjustment="scoring" data-team-id="${team.id}" aria-label="${team.name} scoring multiplier" /></label><label>Conceding <output>${conceding}</output><input type="range" min="0.75" max="1.25" step="0.05" value="${conceding}" data-adjustment="conceding" data-team-id="${team.id}" aria-label="${team.name} conceding multiplier" /></label></div>`;
  }).join('');
}

function renderGrid() {
  const gameweeks = visibleGameweeks();
  const fixtureLookup = new Map(calculatedFixtures().map((fixture) => [`${fixture.teamId}-${fixture.gameweek}`, fixture]));
  const ratingFor = (teamId, gw) => fixtureLookup.get(`${teamId}-${gw}`)?.ratings[state.mode] ?? 0;
  const teams = visibleTeams().sort((left, right) => {
    if (state.sort.target === null) return left.name.localeCompare(right.name);
    const leftValue = state.sort.target === 'all' ? gameweeks.reduce((sum, gw) => sum + ratingFor(left.id, gw), 0) / gameweeks.length : ratingFor(left.id, state.sort.target);
    const rightValue = state.sort.target === 'all' ? gameweeks.reduce((sum, gw) => sum + ratingFor(right.id, gw), 0) / gameweeks.length : ratingFor(right.id, state.sort.target);
    return state.sort.direction * (leftValue - rightValue) || left.name.localeCompare(right.name);
  });
  const rows = teams.map((team) => `<tr><td class="team-cell"><span>${team.name}</span><button class="inline-toggle" type="button" data-hide-club="${team.id}" aria-label="Hide ${team.name}" title="Hide ${team.name}">−</button></td>${gameweeks.map((gw) => {
    const fixture = fixtureLookup.get(`${team.id}-${gw}`);
    if (!fixture) return '<td class="blank-cell" aria-label="No fixture"></td>';
    const value = fixture.ratings[state.mode];
    const displayedValue = state.mode === 'overall' ? value.toFixed(1) : fixture.averages[state.mode].toFixed(1);
    const displayLabel = state.mode === 'overall' ? 'displayed as the FDR score' : `expected goals ${displayedValue}`;
    const title = `${team.name}: ${fixture.opponentName} (${fixture.venue === 'H' ? 'Home' : 'Away'}). ${metricLabel[state.mode]} FDR ${value}/10; ${displayLabel}.`;
    const opponentDisplay = fixture.venue === 'A' ? fixture.opponentShort.toLowerCase() : fixture.opponentShort;
    return `<td class="fixture-cell" tabindex="0" title="${title}" aria-label="${title}" style="background:${ratingColor(value)};color:${ratingTextColor(value)}">${opponentDisplay}<small>${fixture.venue} · ${displayedValue}</small></td>`;
  }).join('')}</tr>`).join('');
  document.querySelector('#fixture-grid-wrap').innerHTML = `<table class="fixture-grid"><thead><tr><th class="team-heading" scope="col"><span>Team</span><button class="sort-toggle" type="button" data-sort="all" aria-label="${sortAria('all', 'all visible gameweeks')}" title="Sort by all visible gameweeks">${sortIcon('all')}</button></th>${gameweeks.map((gw) => `<th scope="col"><span>GW ${gw}</span><button class="sort-toggle" type="button" data-sort="${gw}" aria-label="${sortAria(gw, `gameweek ${gw}`)}" title="Sort by GW ${gw}">${sortIcon(gw)}</button><button class="inline-toggle" type="button" data-hide-gameweek="${gw}" aria-label="Hide gameweek ${gw}" title="Hide gameweek ${gw}">−</button></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  const restoreItems = [...state.data.gameweeks.filter((gw) => state.hiddenGameweeks.has(gw)).map((gw) => `<button class="restore-chip" type="button" data-show-gameweek="${gw}">+ GW ${gw}</button>`), ...state.data.teams.filter((team) => state.hiddenClubs.has(team.id)).map((team) => `<button class="restore-chip" type="button" data-show-club="${team.id}">+ ${team.name}</button>`)];
  document.querySelector('#restore-strip').innerHTML = restoreItems.length ? `<span>Show:</span>${restoreItems.join('')}` : '';
  document.querySelector('#gameweek-start').value = state.startGameweek;
  document.querySelector('#gameweek-end').value = state.endGameweek;
  document.querySelector('#gameweek-range-value').textContent = `${state.startGameweek}–${state.endGameweek}`;
  document.querySelectorAll('.mode-button').forEach((button) => { const active = button.dataset.mode === state.mode; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', active); });
}
function resetFilters() { const defaultRange = defaultGameweekRange(); state.hiddenClubs.clear(); state.hiddenGameweeks.clear(); state.startGameweek = defaultRange.start; state.endGameweek = defaultRange.end; state.sort = { target: null, direction: 1 }; savePreferences(); renderGrid(); }
function setSort(target) { state.sort = state.sort.target === target ? { target, direction: state.sort.direction * -1 } : { target, direction: 1 }; renderGrid(); }
async function init() {
  loadPreferences();
  const response = await fetch('assets/fixtures.json');
  if (!response.ok) throw new Error('Could not load the bundled fixture snapshot.');
  state.data = await response.json();
  const defaultRange = defaultGameweekRange();
  state.startGameweek = Math.max(state.data.gameweeks[0], Math.min(state.startGameweek ?? defaultRange.start, state.data.gameweeks.at(-1)));
  state.endGameweek = Math.max(state.startGameweek, Math.min(state.endGameweek ?? defaultRange.end, state.data.gameweeks.at(-1)));
  for (const input of document.querySelectorAll('#gameweek-start, #gameweek-end')) {
    input.min = state.data.gameweeks[0];
    input.max = state.data.gameweeks.at(-1);
  }
  renderAdjustments();
  renderGrid();
  document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => { state.mode = button.dataset.mode; savePreferences(); renderGrid(); }));
  document.querySelector('#fixture-grid-wrap').addEventListener('click', (event) => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.sort) { setSort(button.dataset.sort === 'all' ? 'all' : Number(button.dataset.sort)); return; }
    if (button.dataset.hideGameweek) { const gw = Number(button.dataset.hideGameweek); state.hiddenGameweeks.add(gw); if (state.sort.target === gw) state.sort.target = null; }
    if (button.dataset.hideClub) state.hiddenClubs.add(Number(button.dataset.hideClub));
    savePreferences(); renderGrid();
  });
  document.querySelector('#restore-strip').addEventListener('click', (event) => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.showGameweek) state.hiddenGameweeks.delete(Number(button.dataset.showGameweek));
    if (button.dataset.showClub) state.hiddenClubs.delete(Number(button.dataset.showClub));
    savePreferences(); renderGrid();
  });
  document.querySelector('#reset-filters').addEventListener('click', resetFilters);
  document.querySelector('#gameweek-start').addEventListener('input', (event) => { state.startGameweek = Math.min(Number(event.target.value), state.endGameweek); savePreferences(); renderGrid(); });
  document.querySelector('#gameweek-end').addEventListener('input', (event) => { state.endGameweek = Math.max(Number(event.target.value), state.startGameweek); savePreferences(); renderGrid(); });
  document.querySelector('#adjustments-list').addEventListener('input', (event) => { const input = event.target; if (!input.dataset.adjustment) return; const teamId = Number(input.dataset.teamId), kind = input.dataset.adjustment; state.adjustments[teamId] = { ...(state.adjustments[teamId] || {}), [kind]: Number(input.value) }; savePreferences(); input.previousElementSibling.textContent = Number(input.value).toFixed(2); renderGrid(); });
  document.querySelector('#reset-adjustments').addEventListener('click', () => { state.adjustments = {}; savePreferences(); renderAdjustments(); renderGrid(); });
}
init().catch((error) => { document.querySelector('#fixture-grid-wrap').innerHTML = `<p style="padding:24px">${error.message}</p>`; });
