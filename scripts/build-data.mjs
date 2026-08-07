import { mkdir, writeFile } from 'node:fs/promises';

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const FIXTURES_URL = 'https://fantasy.premierleague.com/api/fixtures/';
const PREMIER_LEAGUE_URL = 'https://www.football-data.co.uk/mmz4281/2526/E0.csv';
const CHAMPIONSHIP_URL = 'https://www.football-data.co.uk/mmz4281/2526/E1.csv';
const OUTPUT = new URL('../data/fdr-data.json', import.meta.url);
const aliases = new Map([['spurs', 'tottenham'], ['man utd', 'man united'], ['nottm forest', 'nottingham forest'], ['nott m forest', 'nottingham forest'], ['coventry city', 'coventry'], ['hull city', 'hull'], ['ipswich town', 'ipswich']]);
const promotedProxies = new Map([['Coventry City', 'West Ham'], ['Ipswich Town', 'Wolves'], ['Hull City', 'Burnley']]);
const canonical = (name) => aliases.get(name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()) || name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) { const char = text[i], next = text[i + 1]; if (char === '"' && quoted && next === '"') { field += '"'; i += 1; } else if (char === '"') quoted = !quoted; else if (char === ',' && !quoted) { row.push(field); field = ''; } else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i += 1; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; } else field += char; }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...values] = rows; const index = Object.fromEntries(header.map((name, i) => [name.replace(/^\uFEFF/, ''), i]));
  return values.map((valuesRow) => Object.fromEntries(Object.entries(index).map(([name, i]) => [name, valuesRow[i] ?? ''])));
}
function aggregate(records, source) {
  const totals = new Map();
  for (const game of records) { const homeGoals = Number(game.FTHG), awayGoals = Number(game.FTAG); if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
    for (const [team, venue, scored, conceded] of [[game.HomeTeam, 'home', homeGoals, awayGoals], [game.AwayTeam, 'away', awayGoals, homeGoals]]) { const key = canonical(team); const value = totals.get(key) || { source, home: { matches: 0, scored: 0, conceded: 0 }, away: { matches: 0, scored: 0, conceded: 0 } }; value[venue].matches += 1; value[venue].scored += scored; value[venue].conceded += conceded; totals.set(key, value); }
  }
  return totals;
}
function rate(record) { return { scored: +(record.scored / record.matches).toFixed(3), conceded: +(record.conceded / record.matches).toFixed(3), matches: record.matches }; }
function scale(value, values, inverse = false) { const min = Math.min(...values), max = Math.max(...values); const normal = max === min ? .5 : (value - min) / (max - min); return +(1 + (inverse ? 1 - normal : normal) * 9).toFixed(1); }
async function loadJson(url) { const response = await fetch(url); if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`); return response.json(); }
async function loadText(url) { const response = await fetch(url); if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`); return response.text(); }

const [bootstrap, rawFixtures, premierText, championshipText] = await Promise.all([loadJson(FPL_URL), loadJson(FIXTURES_URL), loadText(PREMIER_LEAGUE_URL), loadText(CHAMPIONSHIP_URL)]);
const premier = aggregate(parseCsv(premierText), 'Premier League'); const championship = aggregate(parseCsv(championshipText), 'Championship');
const teams = bootstrap.teams.map((team) => ({ id: team.id, name: team.name, shortName: team.short_name, key: canonical(team.name) }));
const teamStats = new Map();
for (const team of teams) { const proxy = promotedProxies.get(team.name); const stats = proxy ? premier.get(canonical(proxy)) : premier.get(team.key) || championship.get(team.key); if (!stats) throw new Error(`No 2025–26 results found for FPL club: ${team.name}. Add an alias in scripts/build-data.mjs.`); if (stats.home.matches < 19 || stats.away.matches < 19) throw new Error(`Incomplete 2025–26 results for ${team.name}.`); teamStats.set(team.id, { source: proxy ? `Premier League proxy: ${proxy}` : stats.source, home: rate(stats.home), away: rate(stats.away) }); }
const byId = new Map(teams.map((team) => [team.id, team])); const gameweeks = [...new Set(rawFixtures.map((fixture) => fixture.event).filter(Number.isInteger))].sort((a, b) => a - b);
if (rawFixtures.length !== 380 || gameweeks.length !== 38) throw new Error(`Expected a complete 380-fixture, 38-gameweek schedule; found ${rawFixtures.length} fixtures across ${gameweeks.length} gameweeks.`);
const rawTeamFixtures = rawFixtures.flatMap((fixture) => { const home = byId.get(fixture.team_h), away = byId.get(fixture.team_a); if (!home || !away || !fixture.event) throw new Error(`Invalid FPL fixture ${fixture.id}.`); return [[home, away, 'H'], [away, home, 'A']].map(([team, opponent, venue]) => { const teamVenue = venue === 'H' ? 'home' : 'away'; const opponentVenue = venue === 'H' ? 'away' : 'home'; const teamRates = teamStats.get(team.id), opponentRates = teamStats.get(opponent.id); return { teamId: team.id, gameweek: fixture.event, opponentId: opponent.id, opponentName: opponent.name, opponentShort: opponent.shortName, venue, attackRaw: teamRates[teamVenue].scored + opponentRates[opponentVenue].conceded, defenceRaw: teamRates[teamVenue].conceded + opponentRates[opponentVenue].scored }; }); });
const attackValues = rawTeamFixtures.map((fixture) => fixture.attackRaw); const defenceValues = rawTeamFixtures.map((fixture) => fixture.defenceRaw);
const fixtures = rawTeamFixtures.map(({ attackRaw, defenceRaw, ...fixture }) => { const attack = scale(attackRaw, attackValues, true); const defence = scale(defenceRaw, defenceValues); return { ...fixture, ratings: { attack, defence, overall: +((attack + defence) / 2).toFixed(1) }, averages: { attack: +(attackRaw / 2).toFixed(2), defence: +(defenceRaw / 2).toFixed(2) } }; });
const output = { meta: { fixtureSeason: '2026–27', resultsSeason: '2025–26', generatedAt: new Date().toISOString(), sources: { fixtures: FIXTURES_URL, premierLeague: PREMIER_LEAGUE_URL, championship: CHAMPIONSHIP_URL } }, gameweeks, teams: teams.map(({ key, ...team }) => ({ ...team, stats: teamStats.get(team.id) })), fixtures };
await mkdir(new URL('../data/', import.meta.url), { recursive: true }); await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`); console.log(`Wrote ${fixtures.length} team fixtures for ${teams.length} teams to ${OUTPUT.pathname}`);
