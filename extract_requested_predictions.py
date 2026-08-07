#!/usr/bin/env python3
"""Extract GW1-6 predictions for a requested Fantasy Football Hub watchlist."""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPACT = ROOT / "ffh_players_compact.json"
FULL = ROOT / "ffh_players.json"
OUTPUT = ROOT / "ffh_requested_predictions_gw1-6.json"

REQUESTS = {
    "GK": "Raya\nDonnaruma\nPickford\nLamens\nSanchez\nKinsky\nDubravka\nVerbruggen\nSteele\nRushworth\nLeno\nPetrovic\nTrafford",
    "DEF": "Tarkowski\nMykolenko\nGabriel\nCalafiori\nTimber\nMosquera\nGvardiol\nRAN\no’rilley\nNunes\nKhusanov\nJacquet\nVirgil\nKerkez\nRobertson\nThiaw\nAjer\nKayode\nCollins\nHume\nBallard\nAlderete\nMukiele\nRodon\nMuharemovic\nRobinson\nAnderson\nPaalestra\nHato\nLacroix\nVuskovic\nDunk\nKadioglu\nPedro Porro\nVan hecke\nSenesi\nShaw\nMaguire\nGuehi\nDiop\nThomas\nVan ewijk\nKonsa\nMaatsen\nCanvot\nAina\nFrimpong\nColwill\nHill\nJair Cunha\nMunoz",
    "MID": "Fernandes\nMbeumo\nCunha\nSemenyo\nFoden\nWirtz\nSzoboslai\nPalmer\nSaka\nTzolis\nBruno G\nGross\nSangare M\nAnderson\nSarr\nNdiaye\nKDH\nMGW\nDango\nSchade\nRogers\nE le fee\nHughes\nCherki\nWilson\nTonali\nMaddison\nAndrey Santos\nAmpadou\nKluivert\nIwobi",
    "FWD": "Haaland\nJoao Pedro\nDCL\nThiago\nBrobbey\nMuniz\nGarcia\nKousi- Asare\nIsak\nWatkins\nMateta\nIgor Jesus\nGyokeres\nHavertz\nBeto\nSolanke\nEvanilson\nMcBurnie\nRicharlison\nOsula\nBarry",
}

ALIASES = {
    "ran": ["rayan", "ait nouri", "ait-nouri"],
    "o’rilley": ["o riley", "o rilley", "o'riley", "o’ riley"],
    "virgil": ["virgil van dijk"],
    "gabriel": ["gabriel dos santos", "gabriel magalhaes"],
    "saka": ["bukayo", "bukayo saka"],
    "gross": ["pascal gross", "pascal groß"],
    "kdh": ["dewsbury hall"],
    "mgw": ["gibbs white"],
    "dango": ["dango ouattara"],
    "sangare m": ["sangare", "sangaré"],
    "e le fee": ["le fee", "le feé"],
    "kousi- asare": ["kousi asare", "kusi asare", "kusi-asare"],
    "muniz": ["rodrigo muniz"],
    "trafford": ["james harrington trafford"],
    "kadioglu": ["kadioglu", "ferdi kadioglu", "ferdi kadıoğlu"],
    "donnaruma": ["donnarumma"],
    "paalestra": ["palestra"],
    "pedro porro": ["porro"],
    "gross": ["gross", "groß"],
    "andrey santos": ["andrey", "andrey santos"],
    "anderson": ["andersen", "joachim andersen", "joachim anderson"],
    "beto": ["betuncal", "norberto betuncal"],
    "sangare m": ["mamadou sangare", "mamadou sangaré"],
    "ampadou": ["ampadu"],
    "dcl": ["calvert lewin"],
    "jair cunha": ["jair", "cunha"],
    "lamens": ["lammens"],
    "szoboslai": ["szoboszlai"],
    "guehi": ["guehi", "guéhi"],
    "vusk ovic": ["vusković", "vusković"],
}


def norm(value: str) -> str:
    value = value.translate(str.maketrans({"ı": "i", "İ": "I", "ł": "l", "Ł": "L"}))
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower().replace("’", "'")
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def load_players(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload.get("players", [])


def names(player: dict) -> list[str]:
    return [norm(str(player.get(key) or "")) for key in ("displayName", "fullName")]


def matches(requested: str, position: str, players: list[dict]) -> list[dict]:
    key = norm(requested)
    aliases = [key] + [norm(x) for x in ALIASES.get(requested.lower(), [])]
    pool = [p for p in players if p.get("position") == position]
    def score(p: dict) -> int:
        best = 0
        for alias in aliases:
            if not alias:
                continue
            for pn in names(p):
                if not pn:
                    continue
                if alias == pn:
                    best = max(best, 10000 + len(alias))
                elif alias in pn:
                    best = max(best, len(alias))
        return best

    exact = [p for p in pool if score(p)]
    if exact:
        best = max(score(p) for p in exact)
        return sorted([p for p in exact if score(p) == best], key=lambda p: norm(p.get("fullName", "")))
    # Fall back only for the known O'Riley position discrepancy in the source snapshot.
    if requested.lower() != "o’rilley":
        return []
    exact = [p for p in players if score(p)]
    if not exact:
        return []
    best = max(score(p) for p in exact)
    return sorted([p for p in exact if score(p) == best], key=lambda p: norm(p.get("fullName", "")))


def compact_player(player: dict, requested: str, position: str, source: str) -> dict:
    fixtures = [
        {
            "gameweek": f.get("gameweek"),
            "opponent": f.get("opponent"),
            "isHome": f.get("isHome"),
            "predictions": f.get("predictions", {}),
        }
        for f in player.get("fixtures", [])
        if 1 <= int(f.get("gameweek", 0)) <= 6
    ]
    return {
        "requestedName": requested,
        "requestedPosition": position,
        "matchedFrom": source,
        "fullName": player.get("fullName"),
        "displayName": player.get("displayName"),
        "price": player.get("price"),
        "position": player.get("position"),
        "positionMismatch": player.get("position") != position,
        "status": player.get("status"),
        "chanceOfPlaying": player.get("chanceOfPlaying"),
        "team": player.get("team"),
        "fixtures": fixtures,
    }


def main() -> None:
    compact = load_players(COMPACT)
    full = load_players(FULL)
    # Compact is authoritative; full JSON fills players missing from the compact snapshot.
    combined: list[tuple[dict, str]] = [(p, "ffh_players_compact.json") for p in compact]
    seen = {(norm(p.get("fullName", "")), p.get("position"), p.get("team", {}).get("shortName")) for p in compact}
    for p in full:
        key = (norm(p.get("fullName", "")), p.get("position"), p.get("team", {}).get("shortName"))
        if key not in seen:
            combined.append((p, "ffh_players.json fallback"))
            seen.add(key)
    all_players = [p for p, _ in combined]
    source_by_id = {id(p): source for p, source in combined}

    selected: list[dict] = []
    unmatched: list[dict] = []
    ambiguous: list[dict] = []
    counts: dict[str, int] = {}
    for position, block in REQUESTS.items():
        requested_names = [x.strip() for x in block.splitlines() if x.strip()]
        counts[position] = len(requested_names)
        for requested in requested_names:
            candidates = matches(requested, position, all_players)
            if not candidates:
                unmatched.append({"requestedName": requested, "requestedPosition": position})
                continue
            if len(candidates) > 1:
                ambiguous.append({
                    "requestedName": requested,
                    "requestedPosition": position,
                    "candidates": [c.get("fullName") for c in candidates[:5]],
                })
            player = candidates[0]
            selected.append(compact_player(player, requested, position, source_by_id[id(player)]))

    output = {
        "sourceFiles": [str(COMPACT), str(FULL)],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "gameweeks": [1, 2, 3, 4, 5, 6],
        "requestedCounts": counts,
        "matchedCount": len(selected),
        "unmatched": unmatched,
        "ambiguous": ambiguous,
        "players": selected,
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "matchedCount": len(selected), "unmatched": unmatched, "ambiguous": ambiguous}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
