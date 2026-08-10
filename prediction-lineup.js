import { FORMATIONS } from './lineup-model.js';

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

function confidence(percent) {
  if (percent === null || percent === undefined) return { className: 'is-unknown', label: 'No estimate', value: '—' };
  if (percent >= 85) return { className: 'is-nailed', label: 'Nailed', value: `${percent}%` };
  if (percent >= 70) return { className: 'is-likely', label: 'Likely', value: `${percent}%` };
  if (percent >= 50) return { className: 'is-risk', label: 'At risk', value: `${percent}%` };
  return { className: 'is-doubt', label: 'Major doubt', value: `${percent}%` };
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) ? `£${price.toFixed(1)}m` : 'Price unavailable';
}

function playerMarker(player, formation) {
  const position = FORMATIONS[formation]?.find((slot) => slot.key === player.slot);
  if (!position) return '';
  const level = confidence(player.nailedPercent);
  const price = formatPrice(player.price);
  const aria = `${player.displayName}, ${player.slot}, ${price}, ${level.value}, ${level.label}, ${player.availability}`;
  return `<article class="prediction-player-marker ${level.className}" style="--player-x:${position.x}%;--player-y:${position.y}%" aria-label="${escapeHtml(aria)}" title="${escapeHtml(aria)}">
    <span class="prediction-player-role">${escapeHtml(player.slot)}</span>
    <span class="prediction-player-price">${escapeHtml(price)}</span>
    <strong>${escapeHtml(player.displayName)}</strong>
    <span class="prediction-player-confidence"><b>${level.value}</b><small>${level.label}</small></span>
  </article>`;
}

function contenderCard(player) {
  const level = confidence(player.nailedPercent);
  const price = formatPrice(player.price);
  const availability = player.availability === 'available' ? '' : `<span class="contender-availability is-${escapeHtml(player.availability)}">${escapeHtml(player.availability)}</span>`;
  const aria = `${player.displayName}, contender for ${player.targetSlot}, ${price}, ${level.value}, ${level.label}, ${player.availability}`;
  return `<li class="prediction-contender" aria-label="${escapeHtml(aria)}">
    <span class="contender-role">${escapeHtml(player.targetSlot)}</span>
    <span class="contender-name"><strong title="${escapeHtml(player.displayName)}">${escapeHtml(player.displayName)}</strong><small>${escapeHtml(price)}</small></span>
    ${availability}
    <span class="contender-confidence ${level.className}"><b>${level.value}</b><small>${level.label}</small></span>
  </li>`;
}

function teamCard(team) {
  const reviewed = team.predictionStatus === 'reviewed';
  const statusLabel = reviewed ? 'Reviewed' : 'Automatic estimate';
  const evidence = reviewed ? `${team.sourceCount} source${team.sourceCount === 1 ? '' : 's'}` : 'Lower confidence';
  return `<article class="predicted-team-card${reviewed ? '' : ' is-automatic'}" id="lineup-team-${team.teamId}" data-team-id="${team.teamId}">
    <header class="predicted-team-header">
      <div class="predicted-team-identity"><span class="team-monogram" aria-hidden="true">${escapeHtml(team.teamShortName)}</span><div><h3>${escapeHtml(team.teamName)}</h3><p>${team.venue === 'H' ? 'Home' : 'Away'} · ${escapeHtml(team.formation)}</p></div></div>
      <div class="prediction-method"><span class="prediction-method-badge">${statusLabel}</span><small>${evidence} · ${escapeHtml(formatTime(team.updatedAt))}</small></div>
    </header>
    <div class="prediction-pitch" aria-label="${escapeHtml(`${team.teamName} ${team.formation} predicted starting lineup`)}">
      <div class="pitch-halfway" aria-hidden="true"></div><div class="pitch-centre-circle" aria-hidden="true"></div><div class="pitch-box pitch-box-top" aria-hidden="true"></div><div class="pitch-box pitch-box-bottom" aria-hidden="true"></div>
      ${team.starters.map((player) => playerMarker(player, team.formation)).join('')}
    </div>
    <section class="prediction-contenders" aria-label="${escapeHtml(`${team.teamName} players in contention`)}"><h4>In contention</h4><ul>${team.contenders.map(contenderCard).join('')}</ul></section>
  </article>`;
}

function fixtureCard(fixture) {
  const [home, away] = fixture.teams;
  return `<section class="predicted-fixture" aria-labelledby="fixture-${home.teamId}-${away.teamId}">
    <header class="predicted-fixture-header"><span>${escapeHtml(home.teamShortName)}</span><h2 id="fixture-${home.teamId}-${away.teamId}">${escapeHtml(home.teamName)} <b>vs</b> ${escapeHtml(away.teamName)}</h2><span>${escapeHtml(away.teamShortName)}</span></header>
    <div class="predicted-fixture-teams">${teamCard(home)}${teamCard(away)}</div>
  </section>`;
}

function render(snapshot) {
  const teams = snapshot.fixtures.flatMap((fixture) => fixture.teams);
  const reviewed = teams.filter((team) => team.predictionStatus === 'reviewed').length;
  document.querySelector('#prediction-lineup-title').textContent = `Predicted Lineups · GW ${snapshot.gameweek}`;
  document.querySelector('#lineup-header-stats').innerHTML = `<div><span>Fixtures</span><strong>${snapshot.fixtures.length}</strong></div><div><span>Reviewed</span><strong>${reviewed} / ${teams.length}</strong></div><div><span>Generated</span><strong>${escapeHtml(formatTime(snapshot.generatedAt))}</strong></div>`;
  document.querySelector('#prediction-fixtures').innerHTML = snapshot.fixtures.map(fixtureCard).join('');
  document.querySelector('#lineup-status').textContent = `${snapshot.fixtures.length} fixtures · ${reviewed} reviewed lineups · ${teams.length - reviewed} automatic estimates`;
  const jump = document.querySelector('#lineup-team-jump');
  jump.insertAdjacentHTML('beforeend', teams.slice().sort((left, right) => left.teamName.localeCompare(right.teamName)).map((team) => `<option value="${team.teamId}">${escapeHtml(team.teamName)}</option>`).join(''));
  jump.addEventListener('change', () => {
    if (!jump.value) return;
    document.querySelector(`#lineup-team-${CSS.escape(jump.value)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function init() {
  const response = await fetch('assets/lineups.json');
  if (!response.ok) throw new Error('Could not load the predicted lineups.');
  render(await response.json());
}

init().catch((error) => {
  document.querySelector('#lineup-status').textContent = error.message;
  document.querySelector('#lineup-status').classList.add('is-error');
  document.querySelector('#prediction-fixtures').innerHTML = `<div class="lineup-load-error"><strong>Predicted lineups are unavailable.</strong><p>${escapeHtml(error.message)}</p></div>`;
});
