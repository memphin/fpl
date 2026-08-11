#!/usr/bin/env python3
"""Parse the FPL Review ``pred`` worksheet into a validated JSON snapshot."""

from __future__ import annotations

import argparse
import json
import math
import posixpath
import re
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"main": MAIN_NS, "rel": DOC_REL_NS, "pkg": PACKAGE_REL_NS}
REQUIRED_HEADERS = ("Pos", "ID", "Name", "Team", "Elite%")
POSITION_MAP = {"GKP": "GK", "GK": "GK", "DEF": "DEF", "MID": "MID", "FWD": "FWD"}
GAMEWEEK_HEADER = re.compile(r"^(\d+)_(xMins|Pts)$")
CELL_REFERENCE = re.compile(r"^([A-Z]+)")


class WorkbookValidationError(ValueError):
    """Raised when the workbook cannot satisfy the projection contract."""


def column_index(reference: str) -> int:
    match = CELL_REFERENCE.match(reference)
    if not match:
        raise WorkbookValidationError(f"Invalid cell reference: {reference}.")
    value = 0
    for character in match.group(1):
        value = value * 26 + ord(character) - ord("A") + 1
    return value - 1


def shared_strings(archive: ZipFile) -> list[str]:
    try:
        root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(node.text or "" for node in item.findall(".//main:t", NS)) for item in root.findall("main:si", NS)]


def worksheet_path(archive: ZipFile, sheet_name: str) -> str:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    sheet = next((item for item in workbook.findall("main:sheets/main:sheet", NS) if item.get("name") == sheet_name), None)
    if sheet is None:
        raise WorkbookValidationError(f"Workbook is missing the {sheet_name!r} worksheet.")
    relationship_id = sheet.get(f"{{{DOC_REL_NS}}}id")
    relationships = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    relationship = next((item for item in relationships.findall("pkg:Relationship", NS) if item.get("Id") == relationship_id), None)
    if relationship is None or not relationship.get("Target"):
        raise WorkbookValidationError(f"Workbook relationship for {sheet_name!r} is missing.")
    target = relationship.get("Target", "").replace("\\", "/")
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join("xl", target))


def cell_value(cell: ElementTree.Element, strings: list[str]) -> Any:
    cell_type = cell.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//main:t", NS))
    value = cell.findtext("main:v", default="", namespaces=NS)
    if cell_type == "s":
        try:
            return strings[int(value)]
        except (ValueError, IndexError) as exc:
            raise WorkbookValidationError("Workbook contains an invalid shared-string reference.") from exc
    if cell_type in {"str", "e"}:
        return value
    if cell_type == "b":
        return value == "1"
    if value == "":
        return None
    try:
        number = float(value)
    except ValueError:
        return value
    return int(number) if number.is_integer() else number


def worksheet_rows(archive: ZipFile, sheet_name: str) -> list[list[Any]]:
    strings = shared_strings(archive)
    root = ElementTree.fromstring(archive.read(worksheet_path(archive, sheet_name)))
    rows: list[list[Any]] = []
    for row in root.findall("main:sheetData/main:row", NS):
        values: list[Any] = []
        for cell in row.findall("main:c", NS):
            index = column_index(cell.get("r", ""))
            if index >= len(values):
                values.extend([None] * (index - len(values) + 1))
            values[index] = cell_value(cell, strings)
        rows.append(values)
    return rows


def finite_number(value: Any, label: str, row_number: int, minimum: float | None = None, maximum: float | None = None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise WorkbookValidationError(f"Row {row_number} has invalid {label}.") from exc
    if not math.isfinite(number) or (minimum is not None and number < minimum) or (maximum is not None and number > maximum):
        raise WorkbookValidationError(f"Row {row_number} has invalid {label}.")
    return number


def percentage(value: Any, row_number: int) -> float | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("%"):
            return finite_number(text[:-1], "Elite%", row_number, 0, 100)
        return finite_number(text, "Elite%", row_number, 0, 100)
    number = finite_number(value, "Elite%", row_number, 0, 100)
    # Native Excel percentage cells store 11.4% as 0.114. Text exports store 11.4%.
    return number * 100 if 0 < number < 0.01 else number


def parse_rows(rows: list[list[Any]]) -> dict[str, Any]:
    if not rows:
        raise WorkbookValidationError("The pred worksheet is empty.")
    headers = [str(value).strip() if value is not None else "" for value in rows[0]]
    duplicates = {header for header in headers if header and headers.count(header) > 1}
    if duplicates:
        raise WorkbookValidationError(f"Duplicate worksheet headers: {', '.join(sorted(duplicates))}.")
    missing = [header for header in REQUIRED_HEADERS if header not in headers]
    if missing:
        raise WorkbookValidationError(f"Missing worksheet headers: {', '.join(missing)}.")

    gameweek_columns: dict[int, dict[str, int]] = {}
    for index, header in enumerate(headers):
        match = GAMEWEEK_HEADER.match(header)
        if match:
            gameweek_columns.setdefault(int(match.group(1)), {})[match.group(2)] = index
    if not gameweek_columns:
        raise WorkbookValidationError("The pred worksheet has no gameweek projection columns.")
    incomplete = [gameweek for gameweek, columns in gameweek_columns.items() if set(columns) != {"xMins", "Pts"}]
    if incomplete:
        raise WorkbookValidationError(f"Incomplete gameweek column pairs: {', '.join(map(str, sorted(incomplete)))}.")

    header_index = {header: index for index, header in enumerate(headers)}
    players: list[dict[str, Any]] = []
    player_ids: set[int] = set()
    for row_number, row in enumerate(rows[1:], start=2):
        if not any(value is not None and str(value).strip() for value in row):
            continue
        get = lambda header: row[header_index[header]] if header_index[header] < len(row) else None
        player_id_number = finite_number(get("ID"), "player ID", row_number, 1)
        if not player_id_number.is_integer():
            raise WorkbookValidationError(f"Row {row_number} has invalid player ID.")
        player_id = int(player_id_number)
        if player_id in player_ids:
            raise WorkbookValidationError(f"Duplicate FPL Review player ID: {player_id}.")
        player_ids.add(player_id)

        raw_position = str(get("Pos") or "").strip().upper()
        if raw_position not in POSITION_MAP:
            raise WorkbookValidationError(f"Row {row_number} has invalid position {raw_position!r}.")
        fixtures = []
        for gameweek in sorted(gameweek_columns):
            columns = gameweek_columns[gameweek]
            minutes_value = row[columns["xMins"]] if columns["xMins"] < len(row) else None
            points_value = row[columns["Pts"]] if columns["Pts"] < len(row) else None
            if minutes_value in (None, "") and points_value in (None, ""):
                continue
            if minutes_value in (None, "") or points_value in (None, ""):
                raise WorkbookValidationError(f"Row {row_number}, GW {gameweek} has an incomplete points/minutes pair.")
            fixtures.append({
                "gameweek": gameweek,
                "minutes": finite_number(minutes_value, f"GW {gameweek} xMins", row_number, 0, 95),
                "points": finite_number(points_value, f"GW {gameweek} points", row_number),
            })
        players.append({
            "id": player_id,
            "position": POSITION_MAP[raw_position],
            "name": str(get("Name") or "").strip(),
            "team": str(get("Team") or "").strip(),
            "eliteOwnership": percentage(get("Elite%"), row_number),
            "fixtures": fixtures,
        })

    if not players:
        raise WorkbookValidationError("The pred worksheet contains no players.")
    return {"gameweeks": sorted(gameweek_columns), "count": len(players), "players": players}


def parse_workbook(path: Path, sheet_name: str = "pred") -> dict[str, Any]:
    try:
        with ZipFile(path) as archive:
            return parse_rows(worksheet_rows(archive, sheet_name))
    except (BadZipFile, KeyError, ElementTree.ParseError) as exc:
        raise WorkbookValidationError(f"Could not read {path.name} as a valid XLSX workbook.") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("pred.xlsx"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sheet", default="pred")
    args = parser.parse_args()
    try:
        snapshot = parse_workbook(args.input, args.sheet)
    except (OSError, WorkbookValidationError) as exc:
        parser.error(str(exc))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Parsed {snapshot['count']} FPL Review players across {len(snapshot['gameweeks'])} gameweeks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
