import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';
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
  return leftTokens.size + rightTokens.size === 0 ? 0 : (2 * shared) / (leftTokens.size + rightTokens.size);
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

export function buildPlayerDisplayNames(snapshot, fpl, fetchedAt = new Date().toISOString()) {
  if (!Array.isArray(snapshot?.players) || !Array.isArray(fpl?.teams) || !Array.isArray(fpl?.elements) || !Array.isArray(fpl?.events)) {
    throw new Error('Prediction or official FPL input has an invalid shape.');
  }
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

  return { source: FPL_URL, fetchedAt, nextGameweek, names, matches };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length) throw new Error(`Invalid argument: ${key}`);
    values[key.slice(2)] = argv[++index];
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshotPath = resolve(args['prediction-input'] || 'data/ffh_players_compact.json');
  const outputPath = resolve(args.output || 'data/fpl-player-display-names.json');
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  let fpl;
  if (args['bootstrap-input']) {
    fpl = JSON.parse(await readFile(resolve(args['bootstrap-input']), 'utf8'));
  } else {
    const response = await fetch(FPL_URL);
    if (!response.ok) throw new Error(`FPL player data request failed (${response.status}).`);
    fpl = await response.json();
  }
  const output = buildPlayerDisplayNames(snapshot, fpl);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(output.matches).length} official FPL player matches to ${outputPath}.`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
