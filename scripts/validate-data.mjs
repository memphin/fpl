import snapshot from '../data/fdr-data.json' with { type: 'json' };

const fail = (message) => { throw new Error(message); };
if (snapshot.teams.length !== 20) fail(`Expected 20 teams, got ${snapshot.teams.length}.`);
if (snapshot.gameweeks.length !== 38) fail(`Expected 38 gameweeks, got ${snapshot.gameweeks.length}.`);
if (snapshot.fixtures.length !== 760) fail(`Expected 760 team fixtures, got ${snapshot.fixtures.length}.`);
const teamIds = new Set(snapshot.teams.map((team) => team.id));
for (const fixture of snapshot.fixtures) {
  if (!teamIds.has(fixture.teamId) || !teamIds.has(fixture.opponentId)) fail(`Fixture has an unknown team: ${JSON.stringify(fixture)}.`);
  if (!snapshot.gameweeks.includes(fixture.gameweek)) fail(`Fixture has an invalid gameweek: ${fixture.gameweek}.`);
  if (!['H', 'A'].includes(fixture.venue)) fail(`Fixture has an invalid venue: ${fixture.venue}.`);
  for (const [kind, value] of Object.entries(fixture.ratings)) if (value < 1 || value > 10) fail(`${kind} FDR is out of range: ${value}.`);
  for (const [kind, value] of Object.entries(fixture.averages || {})) if (!Number.isFinite(value) || value < 0) fail(`${kind} expected-goals average is invalid: ${value}.`);
}
for (const team of snapshot.teams) for (const gameweek of snapshot.gameweeks) {
  const entries = snapshot.fixtures.filter((fixture) => fixture.teamId === team.id && fixture.gameweek === gameweek);
  if (entries.length !== 1) fail(`${team.name} has ${entries.length} fixtures in GW ${gameweek}; expected one.`);
}
for (const fixture of snapshot.fixtures) {
  const reverse = snapshot.fixtures.find((candidate) => candidate.gameweek === fixture.gameweek && candidate.teamId === fixture.opponentId && candidate.opponentId === fixture.teamId);
  if (!reverse || reverse.venue === fixture.venue) fail(`Missing or invalid reverse fixture for fixture ${fixture.teamId}/${fixture.gameweek}.`);
}
const expectedProxies = new Map([['Coventry City', 'Premier League proxy: West Ham'], ['Ipswich Town', 'Premier League proxy: Wolves'], ['Hull City', 'Premier League proxy: Burnley']]);
for (const [teamName, source] of expectedProxies) { const team = snapshot.teams.find((candidate) => candidate.name === teamName); if (!team || team.stats.source !== source) fail(`${teamName} must use ${source}.`); }
console.log(`Validated ${snapshot.fixtures.length} team fixtures, 38 gameweeks, and the three requested Premier League promoted-club proxies.`);
