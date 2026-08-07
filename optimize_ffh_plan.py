#!/usr/bin/env python3
"""Create a six-gameweek FPL plan from a compact Fantasy Football Hub export.

The plan selects a £100m legal squad, uses the best legal XI and captain each
gameweek, and rolls unused free transfers up to five. It deliberately excludes
chips, price changes, transfer hits, and unannounced injuries.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path
from typing import Any

POSITIONS = ("GK", "DEF", "MID", "FWD")
QUOTAS = {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3}
DEFAULT_LOCKS = (
    "Erling Braut Haaland",
    "Bryan Tetsadong Marceau Mbeumo",
    "Igor Thiago Nascimento Rodrigues",
)
DEFAULT_EXCLUDES = ("Oliver George Arthur Watkins",)


def gameweek_fixture(player: dict[str, Any], gameweek: int) -> dict[str, Any] | None:
    return next((item for item in player.get("fixtures", []) if item.get("gameweek") == gameweek), None)


def player_summary(player: dict[str, Any], gameweek: int | None = None) -> dict[str, Any]:
    result = {
        "fullName": player["fullName"],
        "position": player["position"],
        "team": player["team"]["shortName"],
        "price": player["price"],
    }
    if gameweek is not None:
        fixture = gameweek_fixture(player, gameweek) or {}
        prediction = fixture.get("predictions", {})
        result.update(
            opponent=(fixture.get("opponent") or {}).get("shortName"),
            isHome=fixture.get("isHome"),
            predictedPoints=round(float(prediction.get("points", 0)), 3),
        )
    return result


def prepare_players(raw: list[dict[str, Any]], gameweeks: int, excluded: set[str]) -> dict[str, list[dict[str, Any]]]:
    by_position = {position: [] for position in POSITIONS}
    for item in raw:
        if item.get("fullName") in excluded or item.get("status") != "a" or item.get("position") not in by_position:
            continue
        points: list[float] = []
        for gameweek in range(1, gameweeks + 1):
            fixture = gameweek_fixture(item, gameweek)
            value = (fixture or {}).get("predictions", {}).get("points")
            if not isinstance(value, (int, float)):
                break
            points.append(float(value))
        if len(points) != gameweeks:
            continue
        player = dict(item)
        player["_points"] = points
        player["_club"] = item["team"]["shortName"]
        by_position[player["position"]].append(player)
    return by_position


def legal(squad: dict[str, list[dict[str, Any]]], locked: set[str]) -> bool:
    if sum(player["price"] for players in squad.values() for player in players) > 100:
        return False
    clubs: dict[str, int] = {}
    names = set()
    for position in POSITIONS:
        if len(squad[position]) != QUOTAS[position]:
            return False
        for player in squad[position]:
            names.add(player["fullName"])
            clubs[player["_club"]] = clubs.get(player["_club"], 0) + 1
    return locked <= names and max(clubs.values(), default=0) <= 3


def best_lineup(squad: dict[str, list[dict[str, Any]]], gameweek: int) -> tuple[float, list[dict[str, Any]], str]:
    best: tuple[float, list[dict[str, Any]], str] | None = None
    for defenders in range(3, 6):
        for midfielders in range(2, 6):
            forwards = 10 - defenders - midfielders
            if not 1 <= forwards <= 3:
                continue
            xi = [max(squad["GK"], key=lambda item: item["_points"][gameweek - 1])]
            xi += sorted(squad["DEF"], key=lambda item: item["_points"][gameweek - 1], reverse=True)[:defenders]
            xi += sorted(squad["MID"], key=lambda item: item["_points"][gameweek - 1], reverse=True)[:midfielders]
            xi += sorted(squad["FWD"], key=lambda item: item["_points"][gameweek - 1], reverse=True)[:forwards]
            score = sum(item["_points"][gameweek - 1] for item in xi) + max(item["_points"][gameweek - 1] for item in xi)
            candidate = (score, xi, f"{defenders}-{midfielders}-{forwards}")
            if best is None or candidate[0] > best[0]:
                best = candidate
    assert best is not None
    return best


def horizon_score(squad: dict[str, list[dict[str, Any]]], start: int, gameweeks: int) -> float:
    return sum(best_lineup(squad, gameweek)[0] for gameweek in range(start, gameweeks + 1))


def cheapest_squad(by_position: dict[str, list[dict[str, Any]]], locked: set[str]) -> dict[str, list[dict[str, Any]]]:
    squad = {position: [] for position in POSITIONS}
    locked_players = {player["fullName"]: player for players in by_position.values() for player in players if player["fullName"] in locked}
    if set(locked_players) != locked:
        missing = ", ".join(sorted(locked - set(locked_players)))
        raise ValueError(f"Locked player unavailable in export: {missing}")
    clubs: dict[str, int] = {}
    for player in locked_players.values():
        squad[player["position"]].append(player)
        clubs[player["_club"]] = clubs.get(player["_club"], 0) + 1
    for position in POSITIONS:
        for player in sorted(by_position[position], key=lambda item: (item["price"], -sum(item["_points"]))):
            if len(squad[position]) == QUOTAS[position]:
                break
            if player in squad[position] or clubs.get(player["_club"], 0) >= 3:
                continue
            squad[position].append(player)
            clubs[player["_club"]] = clubs.get(player["_club"], 0) + 1
    if not legal(squad, locked):
        raise ValueError("Could not construct a legal low-cost squad with the locked players.")
    return squad


def optimize_initial(
    by_position: dict[str, list[dict[str, Any]]], locked: set[str], gameweeks: int, seed: int
) -> dict[str, list[dict[str, Any]]]:
    random.seed(seed)
    pool = {
        position: list(
            {item["fullName"]: item for item in sorted(players, key=lambda item: sum(item["_points"]), reverse=True)[:90]
             + sorted(players, key=lambda item: item["price"])[:45]}.values()
        )
        for position, players in by_position.items()
    }
    best = cheapest_squad(by_position, locked)
    best_value = horizon_score(best, 1, gameweeks)
    for _ in range(20):
        squad = {position: list(players) for position, players in best.items()}
        value = horizon_score(squad, 1, gameweeks)
        for step in range(4_000):
            position = random.choice(POSITIONS)
            index = random.randrange(QUOTAS[position])
            old = squad[position][index]
            if old["fullName"] in locked:
                continue
            new = random.choice(pool[position])
            if new in squad[position]:
                continue
            trial = {key: list(value) for key, value in squad.items()}
            trial[position][index] = new
            if not legal(trial, locked):
                continue
            next_value = horizon_score(trial, 1, gameweeks)
            temperature = 0.45 * (1 - step / 4_000) + 0.006
            if next_value >= value or random.random() < math.exp((next_value - value) / temperature):
                squad, value = trial, next_value
            if value > best_value:
                best, best_value = {key: list(value) for key, value in squad.items()}, value
    return best


def choose_transfers(
    squad: dict[str, list[dict[str, Any]]], by_position: dict[str, list[dict[str, Any]]], locked: set[str], gameweek: int,
    gameweeks: int, available: int,
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    pool = {
        position: list(
            {item["fullName"]: item for item in sorted(players, key=lambda item: sum(item["_points"][gameweek - 1:]), reverse=True)[:100]
             + sorted(players, key=lambda item: item["price"])[:40]}.values()
        )
        for position, players in by_position.items()
    }
    chosen: list[dict[str, Any]] = []
    for _ in range(available):
        current_score = horizon_score(squad, gameweek, gameweeks)
        best: tuple[float, dict[str, list[dict[str, Any]]], dict[str, Any]] | None = None
        for position in POSITIONS:
            for old in squad[position]:
                if old["fullName"] in locked:
                    continue
                for new in pool[position]:
                    if new in squad[position]:
                        continue
                    trial = {key: list(value) for key, value in squad.items()}
                    trial[position].remove(old)
                    trial[position].append(new)
                    if not legal(trial, locked):
                        continue
                    value = horizon_score(trial, gameweek, gameweeks)
                    if best is None or value > best[0]:
                        best = (value, trial, {"out": player_summary(old), "in": player_summary(new)})
        if best is None or best[0] <= current_score + 1e-9:
            break
        _, squad, transfer = best
        chosen.append(transfer)
    return squad, chosen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path(__file__).with_name("ffh_players_compact.json"))
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("ffh_plan_gw1-6.json"))
    parser.add_argument("--gameweeks", type=int, default=6)
    parser.add_argument("--lock", action="append", default=list(DEFAULT_LOCKS), help="Player full name to keep throughout the plan")
    parser.add_argument("--exclude", action="append", default=list(DEFAULT_EXCLUDES), help="Player full name to exclude")
    args = parser.parse_args()
    raw = json.loads(args.input.read_text(encoding="utf-8"))
    players = raw.get("players") if isinstance(raw, dict) else None
    if not isinstance(players, list):
        parser.error("input must contain a players list")
    locked, excluded = set(args.lock), set(args.exclude)
    if locked & excluded:
        parser.error("a player cannot be both locked and excluded")
    by_position = prepare_players([item for item in players if isinstance(item, dict)], args.gameweeks, excluded)
    squad = optimize_initial(by_position, locked, args.gameweeks, seed=20260804)
    initial_squad = [player_summary(player) for position in POSITIONS for player in squad[position]]
    initial_squad_cost = round(sum(player["price"] for position in POSITIONS for player in squad[position]), 1)
    plan: list[dict[str, Any]] = []
    carried = 0
    for gameweek in range(1, args.gameweeks + 1):
        available = 0 if gameweek == 1 else min(carried + 1, 5)
        transfers: list[dict[str, Any]] = []
        if gameweek > 1 and available:
            squad, transfers = choose_transfers(squad, by_position, locked, gameweek, args.gameweeks, available)
        carried = available - len(transfers)
        points, xi, formation = best_lineup(squad, gameweek)
        captain = max(xi, key=lambda item: item["_points"][gameweek - 1])
        starters = {id(item) for item in xi}
        plan.append(
            {
                "gameweek": gameweek,
                "freeTransfersAvailable": available,
                "transfersUsed": len(transfers),
                "freeTransfersCarried": carried,
                "transfers": transfers,
                "formation": formation,
                "captain": player_summary(captain, gameweek),
                "predictedPointsIncludingCaptain": round(points, 3),
                "startingXI": [player_summary(player, gameweek) for player in xi],
                "bench": [player_summary(player, gameweek) for position in POSITIONS for player in squad[position] if id(player) not in starters],
            }
        )
    output = {
        "source": raw.get("source"),
        "assumptions": {
            "budget": 100.0,
            "maxPlayersPerClub": 3,
            "lockedPlayers": sorted(locked),
            "excludedPlayers": sorted(excluded),
            "transferHits": False,
            "priceChanges": False,
            "chips": False,
            "maxStoredFreeTransfers": 5,
        },
        "initialSquad": initial_squad,
        "initialSquadCost": initial_squad_cost,
        "gameweeks": plan,
        "totalPredictedPointsIncludingCaptain": round(sum(item["predictedPointsIncludingCaptain"] for item in plan), 3),
    }
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Saved {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
