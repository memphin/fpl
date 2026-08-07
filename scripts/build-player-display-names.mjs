import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const snapshotPath = resolve(root, 'data/ffh_players_compact.json');
const outputPath = resolve(root, 'data/fpl-player-display-names.json');
const ignoredWords = new Set(['de', 'da', 'do', 'dos', 'das', 'del', 'di', 'van', 'von', 'la', 'le', 'el', 'du', 'des', 'der', 'den', 'ten', 'ter', 'the']);

function normalise(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value) {
  return new Set(normalise(value).split(' ').filter((word) => word && !ignoredWords.has(word)));
}

function nameSimilarity(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const shared = [...leftTokens].filter((word) => rightTokens.has(word)).length;
  return (2 * shared) / (leftTokens.size + rightTokens.size);
}

function lastNameToken(value) {
  return [...tokens(value)].at(-1);
}

function bestMatch(player, candidates) {
  return candidates
    .map((candidate) => {
      const surnameMatches = lastNameToken(player.fullName) === lastNameToken(candidate.second_name);
      return { candidate, score: nameSimilarity(player.fullName, `${candidate.first_name} ${candidate.second_name}`) + (surnameMatches ? 1 : 0) };
    })
    .sort((left, right) => right.score - left.score || left.candidate.web_name.localeCompare(right.candidate.web_name))[0];
}

const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const response = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
if (!response.ok) throw new Error(`FPL player data request failed (${response.status}).`);
const fpl = await response.json();
const teamNames = new Map(fpl.teams.map((team) => [team.id, team.name]));
const nextGameweek = fpl.events.find((event) => event.is_next)?.id ?? snapshot.gameweeks.min;
const names = {};
const matches = {};
const matchedIds = new Set();

for (const player of snapshot.players) {
  const teamCandidates = fpl.elements.filter((candidate) => teamNames.get(candidate.team) === player.team.fullName);
  let match = bestMatch(player, teamCandidates);
  if (!match || match.score === 0) match = bestMatch(player, fpl.elements);
  if (!match || match.score === 0) throw new Error(`Could not match ${player.fullName} to an FPL player.`);
  if (matchedIds.has(match.candidate.id)) throw new Error(`Official FPL player ${match.candidate.web_name} matched more than once.`);
  matchedIds.add(match.candidate.id);
  names[player.fullName] = match.candidate.web_name;
  matches[player.fullName] = { id: match.candidate.id, displayName: match.candidate.web_name, teamId: match.candidate.team };
}

await writeFile(outputPath, `${JSON.stringify({ source: 'https://fantasy.premierleague.com/api/bootstrap-static/', fetchedAt: new Date().toISOString(), nextGameweek, names, matches }, null, 2)}\n`);
console.log(`Wrote ${Object.keys(matches).length} official FPL player matches to ${outputPath}.`);
