#!/usr/bin/env python3
"""Download Fantasy Football Hub player predictions as JSON.

Authentication
--------------
The script can use an existing API bearer token or obtain a short-lived token
from the Hub's authenticated access-token endpoint using a browser session
cookie. A password-login option is included only for sessions where Hub does
not require CAPTCHA/MFA; those challenges must be completed in a browser.
Secrets are never included in the output file.

Examples (PowerShell)
---------------------
  $env:FFH_SESSION_COOKIE = 'cookie-name=value; other-cookie=value'
  python ./fetch_predicted_points.py --min-gameweek 1 --max-gameweek 10

  $env:FFH_TOKEN = 'existing-bearer-token'
  python ./fetch_predicted_points.py --max-gameweek 5 --output players.json

  # If Hub does not show a CAPTCHA/MFA challenge for your account:
  $env:FFH_USERNAME = 'you@example.com'
  python ./fetch_predicted_points.py  # securely prompts for the password
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from getpass import getpass
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, OpenerDirector, Request, build_opener, urlopen

TOKEN_URL = "https://www.fantasyfootballhub.co.uk/auth/access-token"
PLAYERS_URL = "https://public-api.fantasyfootballhub.co.uk/league/players"
POSITIONS = ("GK", "DEF", "MID", "FWD")
ZERO_POINTS_PRICE_LIMIT = 4.5
ORIGIN = "https://www.fantasyfootballhub.co.uk"
USER_AGENT = "Mozilla/5.0 (compatible; FFH predictions exporter/1.0)"
DEFAULT_USERNAME = "ivanjuric.work@gmail.com"


class LoginFormParser(HTMLParser):
    """Extract Auth0's dynamic login form fields without storing its HTML."""

    def __init__(self) -> None:
        super().__init__()
        self.form_action: str | None = None
        self.fields: dict[str, str] = {}
        self.requires_captcha = False
        self._in_primary_form = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "form" and attributes.get("data-form-primary") == "true":
            self._in_primary_form = True
            self.form_action = attributes.get("action")
        elif tag == "input" and self._in_primary_form and attributes.get("name"):
            self.fields[attributes["name"]] = attributes.get("value") or ""
        elif attributes.get("data-captcha-provider"):
            self.requires_captcha = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "form":
            self._in_primary_form = False


def request_json(
    url: str, headers: dict[str, str], timeout: int, opener: OpenerDirector | None = None
) -> dict[str, Any]:
    request = Request(url, headers=headers, method="GET")
    try:
        open_url = opener.open if opener else urlopen
        with open_url(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:1000]
        if exc.code == 401 and url == TOKEN_URL:
            raise RuntimeError(
                "FFH session is missing or expired. Set FFH_SESSION_COOKIE from an "
                "authenticated Fantasy Football Hub browser request, or set FFH_TOKEN."
            ) from exc
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("Server returned invalid JSON.") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected API response: expected a JSON object.")
    return payload


def find_token(value: Any) -> str | None:
    """Find the token despite response-shape changes at the auth endpoint."""
    if isinstance(value, dict):
        for key in ("accessToken", "access_token", "token", "jwt"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        for key in ("data", "result", "session"):
            token = find_token(value.get(key))
            if token:
                return token
    return None


def login(username: str, password: str, timeout: int) -> OpenerDirector:
    """Complete Hub's Auth0 browser login and retain its cookies in memory only."""
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    start_url = (
        f"{ORIGIN}/auth/login?"
        "connection=Username-Password-Authentication&returnTo=%2F"
    )
    try:
        with opener.open(Request(start_url, headers={"User-Agent": USER_AGENT}), timeout=timeout) as response:
            page_url = response.url
            page = response.read().decode("utf-8", errors="replace")
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"Could not open FFH login page: {exc}") from exc

    form = LoginFormParser()
    form.feed(page)
    if "state" not in form.fields:
        raise RuntimeError("FFH login page changed: its Auth0 login form was not found.")
    if form.requires_captcha:
        raise RuntimeError(
            "FFH password login currently requires a browser CAPTCHA. Complete the login "
            "in a browser and set FFH_SESSION_COOKIE instead; this script will not bypass CAPTCHA."
        )
    form.fields.update({"username": username, "password": password, "action": "default"})
    post_url = form.form_action or page_url
    if post_url.startswith("/"):
        post_url = "https://auth.fantasyfootballhub.co.uk" + post_url
    request = Request(
        post_url,
        data=urlencode(form.fields).encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://auth.fantasyfootballhub.co.uk",
            "Referer": page_url,
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            final_url = response.url
            response.read()
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"FFH login failed: {exc}") from exc
    if final_url.startswith("https://auth.fantasyfootballhub.co.uk/"):
        raise RuntimeError(
            "FFH did not complete the password login. Check the credentials, or complete "
            "any CAPTCHA/MFA in a browser and use FFH_SESSION_COOKIE instead."
        )
    return opener


def get_token(session_cookie: str | None, username: str | None, password: str | None, timeout: int) -> str:
    token = (os.environ.get("FFH_TOKEN") or os.environ.get("FANTASY_FOOTBALL_HUB_TOKEN") or "").strip()
    if token:
        return token.removeprefix("Bearer ").strip()
    opener: OpenerDirector | None = None
    # A browser session takes precedence over the configured account name:
    # it has already passed Hub's CAPTCHA/MFA and is the most reliable path.
    if session_cookie:
        pass
    elif username:
        if not password:
            raise RuntimeError("FFH username was provided but no password was supplied.")
        opener = login(username, password, timeout)
    else:
        raise RuntimeError(
            "No credentials found. Set FFH_TOKEN, FFH_SESSION_COOKIE, or FFH_USERNAME; see --help for examples."
        )

    headers = {
        "Accept": "application/json",
        "Origin": ORIGIN,
        "Referer": f"{ORIGIN}/",
        "User-Agent": USER_AGENT,
    }
    if session_cookie:
        headers["Cookie"] = session_cookie
    payload = request_json(
        TOKEN_URL,
        headers,
        timeout,
        opener,
    )
    token = find_token(payload)
    if not token:
        raise RuntimeError("Access-token response did not contain an access token.")
    return token


def next_cursor(payload: dict[str, Any]) -> str | None:
    for container in (payload, payload.get("meta")):
        if not isinstance(container, dict):
            continue
        for key in ("after", "next", "nextCursor", "next_cursor"):
            value = container.get(key)
            if isinstance(value, str) and value:
                return value
            if isinstance(value, dict):
                for nested_key in ("after", "cursor", "value"):
                    nested = value.get(nested_key)
                    if isinstance(nested, (str, int)) and str(nested):
                        return str(nested)
    return None


def fetch_position(args: argparse.Namespace, token: str, position: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    after: str | None = None
    seen_cursors: set[str] = set()

    while True:
        params: dict[str, str | int | float] = {
            "limit": args.limit,
            "position": position,
            "minGameweek": args.min_gameweek,
            "maxGameweek": args.max_gameweek,
            "minPrice": args.min_price,
            "maxPrice": args.max_price,
            "sortBy": args.sort_by,
            "sortDirection": args.sort_direction,
        }
        if after:
            params["after"] = after
        payload = request_json(
            f"{PLAYERS_URL}?{urlencode(params)}",
            {
                "Accept": "application/json",
                "Authorization": f"Bearer {token}",
                "Origin": ORIGIN,
                "Referer": f"{ORIGIN}/",
                "User-Agent": USER_AGENT,
            },
            args.timeout,
        )
        page = payload.get("data")
        if not isinstance(page, list):
            raise RuntimeError(f"Unexpected players response for {position}: missing data list.")
        rows.extend(player for player in page if isinstance(player, dict))
        print(f"{position}: +{len(page)} players (total {len(rows)})", flush=True)

        if len(page) < args.limit:
            return rows
        after = next_cursor(payload)
        if not after or after in seen_cursors:
            raise RuntimeError(f"{position}: full page but no usable next-page cursor.")
        seen_cursors.add(after)
        time.sleep(args.delay)


def simplify_fixture(fixture: dict[str, Any]) -> dict[str, Any]:
    """Keep only the prediction fields useful for a compact player export."""
    opponent = fixture.get("opponent")
    prediction = fixture.get("predictions")
    opponent_name = opponent.get("shortName") if isinstance(opponent, dict) else None
    prediction = prediction if isinstance(prediction, dict) else {}
    return {
        "gameweek": fixture.get("gameweek"),
        "opponent": {"shortName": opponent_name},
        "isHome": fixture.get("isHome"),
        "predictions": {
            key: prediction.get(key)
            for key in ("points", "minutes", "goals", "assists", "cleanSheets", "returns")
        },
    }


def simplify_player(player: dict[str, Any]) -> dict[str, Any]:
    """Remove provider IDs, images, historical stats, and probabilities."""
    team = player.get("team")
    fixtures = player.get("fixtures")
    team = team if isinstance(team, dict) else {}
    fixtures = fixtures if isinstance(fixtures, list) else []
    return {
        "fullName": player.get("fullName"),
        "price": player.get("price"),
        "position": player.get("position"),
        "ownership": player.get("ownership"),
        "status": player.get("status"),
        "team": {
            "shortName": team.get("shortName"),
            "fullName": team.get("fullName"),
        },
        "fixtures": [simplify_fixture(fixture) for fixture in fixtures if isinstance(fixture, dict)],
    }


def predicted_points_total(player: dict[str, Any]) -> float:
    """Return a player's total predicted points in the fetched gameweek range."""
    fixtures = player.get("fixtures")
    if not isinstance(fixtures, list):
        return 0.0
    return sum(
        float(prediction.get("points") or 0)
        for fixture in fixtures
        if isinstance(fixture, dict)
        for prediction in [fixture.get("predictions")]
        if isinstance(prediction, dict)
    )


def exclude_zero_point_expensive_players(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove players priced above £4.5m with no points predicted at all."""
    return [
        player
        for player in players
        if not (
            float(player.get("price") or 0) > ZERO_POINTS_PRICE_LIMIT
            and predicted_points_total(player) == 0
        )
    ]


def write_compact_json(path: Path, payload: dict[str, Any]) -> None:
    """Write valid JSON without whitespace added for human readability."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--session-cookie", default=os.environ.get("FFH_SESSION_COOKIE"), help="Cookie header; prefer FFH_SESSION_COOKIE")
    parser.add_argument(
        "--username",
        default=os.environ.get("FFH_USERNAME") or DEFAULT_USERNAME,
        help="Hub email address (defaults to the configured account; FFH_USERNAME overrides it)",
    )
    parser.add_argument("--password-stdin", action="store_true", help="Read Hub password from standard input (for automation)")
    parser.add_argument("--min-gameweek", type=int, default=1)
    parser.add_argument("--max-gameweek", type=int, default=10)
    parser.add_argument("--min-price", type=float, default=4.0)
    parser.add_argument("--max-price", type=float, default=16.0)
    parser.add_argument("--sort-by", default="price")
    parser.add_argument("--sort-direction", choices=("asc", "desc"), default="desc")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--delay", type=float, default=0.2)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--input", type=Path, help="Convert an existing raw Hub JSON export without downloading")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("ffh_players.json"))
    args = parser.parse_args()

    if args.max_gameweek < args.min_gameweek or args.limit < 1:
        parser.error("gameweek range and --limit must be positive and valid")
    if args.input:
        try:
            raw_export = json.loads(args.input.read_text(encoding="utf-8"))
            raw_players = raw_export.get("players") if isinstance(raw_export, dict) else None
            if not isinstance(raw_players, list):
                raise ValueError("missing players list")
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"ERROR: Could not read raw export: {exc}", file=sys.stderr)
            return 1
        filtered_players = exclude_zero_point_expensive_players(
            [player for player in raw_players if isinstance(player, dict)]
        )
        output = {
            "source": raw_export.get("source", PLAYERS_URL),
            "fetchedAt": raw_export.get("fetchedAt"),
            "gameweeks": raw_export.get("gameweeks"),
            "countsByPosition": {
                position: sum(player.get("position") == position for player in filtered_players)
                for position in POSITIONS
            },
            "count": len(filtered_players),
            "players": [simplify_player(player) for player in filtered_players],
        }
        write_compact_json(args.output, output)
        print(f"Converted {len(raw_players)} players; kept {output['count']} in {args.output}")
        return 0
    try:
        password = None
        has_bearer_token = bool(
            (os.environ.get("FFH_TOKEN") or os.environ.get("FANTASY_FOOTBALL_HUB_TOKEN") or "").strip()
        )
        # Do not prompt when an API token or an authenticated browser session
        # was supplied: neither requires the account password.
        if args.username and not has_bearer_token and not args.session_cookie:
            password = sys.stdin.readline().rstrip("\r\n") if args.password_stdin else getpass("Fantasy Football Hub password: ")
        token = get_token(args.session_cookie, args.username, password, args.timeout)
        combined: list[dict[str, Any]] = []
        for position in POSITIONS:
            records = fetch_position(args, token, position)
            combined.extend(records)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    unique: dict[str, dict[str, Any]] = {}
    for index, player in enumerate(combined):
        external_ids = player.get("externalIds")
        fpl_id = external_ids.get("fplId") if isinstance(external_ids, dict) else None
        key = str(player.get("id") or fpl_id or f"unknown:{index}")
        unique.setdefault(key, player)

    filtered_players = exclude_zero_point_expensive_players(list(unique.values()))
    output = {
        "source": PLAYERS_URL,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "gameweeks": {"min": args.min_gameweek, "max": args.max_gameweek},
        "countsByPosition": {
            position: sum(player.get("position") == position for player in filtered_players)
            for position in POSITIONS
        },
        "count": len(filtered_players),
        "players": [simplify_player(player) for player in filtered_players],
    }
    write_compact_json(args.output, output)
    print(f"Saved {len(filtered_players)} of {len(unique)} unique players to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
