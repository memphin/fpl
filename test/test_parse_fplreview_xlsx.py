import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "scripts" / "parse_fplreview_xlsx.py"
SPEC = importlib.util.spec_from_file_location("parse_fplreview_xlsx", MODULE_PATH)
parser = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(parser)


class FplReviewParserTests(unittest.TestCase):
    def test_parses_gameweeks_positions_percentages_and_missing_values(self):
        result = parser.parse_rows([
            ["Pos", "ID", "Name", "Team", "1_xMins", "1_Pts", "2_xMins", "2_Pts", "Elite%"],
            ["GKP", 1, "Raya", "ARS", 94, 4.55, 92, 3.9, "31.0%"],
            ["MID", 2, "Saka", "ARS", 52, 0, None, None, None],
        ])
        self.assertEqual(result["gameweeks"], [1, 2])
        self.assertEqual(result["players"][0]["position"], "GK")
        self.assertEqual(result["players"][0]["eliteOwnership"], 31)
        self.assertEqual(result["players"][1]["fixtures"], [{"gameweek": 1, "minutes": 52.0, "points": 0.0}])
        self.assertIsNone(result["players"][1]["eliteOwnership"])

    def test_rejects_duplicate_ids_incomplete_pairs_and_bad_ranges(self):
        header = ["Pos", "ID", "Name", "Team", "1_xMins", "1_Pts", "Elite%"]
        with self.assertRaisesRegex(parser.WorkbookValidationError, "Duplicate FPL Review player ID"):
            parser.parse_rows([header, ["DEF", 4, "A", "ARS", 90, 4, "1%"], ["DEF", 4, "B", "ARS", 80, 3, "2%"]])
        with self.assertRaisesRegex(parser.WorkbookValidationError, "incomplete points/minutes pair"):
            parser.parse_rows([header, ["DEF", 4, "A", "ARS", 90, None, "1%"]])
        with self.assertRaisesRegex(parser.WorkbookValidationError, "Incomplete gameweek column pairs"):
            parser.parse_rows([["Pos", "ID", "Name", "Team", "1_xMins", "Elite%"], ["DEF", 4, "A", "ARS", 90, "1%"]])
        with self.assertRaisesRegex(parser.WorkbookValidationError, "invalid GW 1 xMins"):
            parser.parse_rows([header, ["DEF", 4, "A", "ARS", 96, 4, "1%"]])
        with self.assertRaisesRegex(parser.WorkbookValidationError, "invalid Elite%"):
            parser.parse_rows([header, ["DEF", 4, "A", "ARS", 90, 4, "101%"]])

    def test_real_workbook_contract(self):
        workbook = Path(__file__).parents[1] / "pred.xlsx"
        result = parser.parse_workbook(workbook)
        self.assertEqual(result["count"], 587)
        self.assertEqual(result["gameweeks"], list(range(1, 11)))
        self.assertEqual(len({player["id"] for player in result["players"]}), 587)


if __name__ == "__main__":
    unittest.main()
