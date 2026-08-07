#!/usr/bin/env python3
"""Fetch Fantasy Football Hub player predicted points for gameweeks 1-10.

The bearer token is supplied at runtime with --token or FFH_TOKEN and is never
written to disk. Results are written to ffh_players_gw1-10.json.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_URL = "https://public-api.fantasyfootballhub.co.uk/league/players"
POSITIONS = ("GK", "DEF", "MID", "FWD")
PAGE_SIZE = 100
MIN_GAMEWEEK = 1
MAX_GAMEWEEK = 10


def fetch_page(token: str, position: str, offset: int) -> dict:
    params = {
        "limit": PAGE_SIZE,
        "position": position,
        "minGameweek": MIN_GAMEWEEK,
        "maxGameweek": MAX_GAMEWEEK,
        "minPrice": 0,
        "maxPrice": 100,
        "sortBy": "price",
        "sortDirection": "desc",
    }
    if offset:
        params["after"] = str(offset)

    request = Request(
        f"{API_URL}?{urlencode(params)}",
        headers={
            "Accept": "application/json, */*",
            "Authorization": f"Bearer {token}",
            "Origin": "https://www.fantasyfootballhub.co.uk",
            "Referer": "https://www.fantasyfootballhub.co.uk/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143 Safari/537.36",
        },
    )
    with urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_players(payload: dict) -> tuple[list, object | None]:
    if isinstance(payload, list):
        return payload, None
    if not isinstance(payload, dict):
        return [], None

    for key in ("players", "data", "results", "items"):
        value = payload.get(key)
        if isinstance(value, list):
            return value, payload
        if isinstance(value, dict):
            nested, _ = extract_players(value)
            if nested:
                return nested, payload

    return [], payload


def next_cursor(payload: dict, current_offset: int, count: int) -> int | None:
    if not isinstance(payload, dict):
        return None

    for key in ("next", "nextOffset", "nextCursor", "after"):
        value = payload.get(key)
        if isinstance(value, dict):
            for nested_key in ("offset", "cursor", "after", "value"):
                nested = value.get(nested_key)
                if nested not in (None, ""):
                    try:
                        return int(nested)
                    except (TypeError, ValueError):
                        pass
        elif value not in (None, "") and key != "after":
            try:
                return int(value)
            except (TypeError, ValueError):
                pass

    # The API examples use `after` as a numeric cursor. If no explicit cursor
    # is returned, offset pagination is a safe fallback for the first test.
    return current_offset + count if count == PAGE_SIZE else None


def fetch_position(token: str, position: str) -> list:
    all_players: list = []
    offset = 0
    seen_offsets: set[int] = set()

    while True:
        if offset in seen_offsets:
            raise RuntimeError(f"Pagination loop detected for {position} at offset {offset}")
        seen_offsets.add(offset)

        payload = fetch_page(token, position, offset)
        players, metadata = extract_players(payload)
        if not players:
            break

        all_players.extend(players)
        print(f"{position}: fetched {len(players)} (total {len(all_players)})", flush=True)

        if len(players) < PAGE_SIZE:
            break
        candidate = next_cursor(metadata if isinstance(metadata, dict) else {}, offset, len(players))
        if candidate is None or candidate == offset:
            break
        offset = candidate
        time.sleep(0.15)

    # De-duplicate if the endpoint returns overlapping pages.
    unique: dict[str, object] = {}
    for index, player in enumerate(all_players):
        if isinstance(player, dict):
            key = str(player.get("id") or player.get("playerId") or f"{position}:{index}")
        else:
            key = f"{position}:{index}"
        unique[key] = player
    return list(unique.values())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=os.environ.get("FFH_TOKEN"), help="FFH bearer token; prefer FFH_TOKEN")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("ffh_players_gw1-10.json"))
    args = parser.parse_args()

    if not args.token:
        print("Missing token. Pass --token or set FFH_TOKEN.", file=sys.stderr)
        return 2

    combined: dict[str, list] = {}
    try:
        for position in POSITIONS:
            combined[position] = fetch_position(args.token, position)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        print(f"HTTP {error.code} while fetching FFH data: {body[:1000]}", file=sys.stderr)
        return 1
    except (URLError, TimeoutError) as error:
        print(f"Network error while fetching FFH data: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Fetch failed: {error}", file=sys.stderr)
        return 1

    result = {
        "source": API_URL,
        "minGameweek": MIN_GAMEWEEK,
        "maxGameweek": MAX_GAMEWEEK,
        "positions": combined,
        "playerCount": sum(len(players) for players in combined.values()),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {result['playerCount']} players to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
