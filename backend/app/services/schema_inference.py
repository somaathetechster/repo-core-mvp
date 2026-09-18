"""
Schema inference: works out what each column actually IS.

This is the layer that makes correct visualization possible. The previous
implementation assumed "first column is labels, everything else is numeric"
and stripped non-digits with a regex, which silently turned "N/A" into 0,
treated "2026-03" as the number 202603, and produced meaningless charts.

Here we infer, per column:
  - a real type (integer, decimal, currency, percentage, date, boolean,
    category, identifier, text), with the parsing rules that come with it
  - a semantic ROLE (temporal dimension, categorical dimension, measure,
    identifier), which is what actually determines an appropriate chart
  - quality diagnostics (null rate, mixed types, outliers, duplicates)

Values are parsed, not regex-stripped: "₦57,444.96" becomes 57444.96 with
currency NGN recorded; "75.7%" becomes 0.757 with a percentage flag; "Mar
2026" becomes a real date with month granularity.
"""
import re
import statistics
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from dateutil import parser as date_parser


# Column types, ordered from most to least specific.
TYPE_BOOLEAN = "boolean"
TYPE_PERCENTAGE = "percentage"
TYPE_CURRENCY = "currency"
TYPE_INTEGER = "integer"
TYPE_DECIMAL = "decimal"
TYPE_DATE = "date"
TYPE_IDENTIFIER = "identifier"
TYPE_CATEGORY = "category"
TYPE_TEXT = "text"
TYPE_EMPTY = "empty"

# Semantic roles: what a column means for analysis and charting.
ROLE_TEMPORAL = "temporal"      # a time axis
ROLE_CATEGORICAL = "categorical"  # a grouping dimension
ROLE_MEASURE = "measure"        # a quantity to aggregate/plot
ROLE_IDENTIFIER = "identifier"  # a key, not meaningful to plot
ROLE_TEXT = "text"              # free text, not chartable

CURRENCY_SYMBOLS = {
    "$": "USD", "€": "EUR", "£": "GBP", "₦": "NGN", "¥": "JPY",
    "₹": "INR", "R": "ZAR", "KSh": "KES", "GH₵": "GHS",
}

CURRENCY_CODES = {"USD", "EUR", "GBP", "NGN", "JPY", "INR", "ZAR", "KES", "GHS", "USDT", "USDC"}

BOOLEAN_TRUE = {"true", "yes", "y", "1", "t"}
BOOLEAN_FALSE = {"false", "no", "n", "0", "f"}

# Column names that strongly hint at a role regardless of values.
TEMPORAL_NAME_HINTS = {"date", "month", "year", "week", "day", "period", "time", "quarter", "timestamp", "created", "updated"}
MEASURE_NAME_HINTS = {"amount", "total", "count", "revenue", "cost", "profit", "volume", "price", "value", "sum", "qty", "quantity", "rate", "score", "balance", "spend", "fee", "margin"}
IDENTIFIER_NAME_HINTS = {"id", "uuid", "key", "ref", "reference", "hash", "code", "sku"}


@dataclass
class ColumnProfile:
    name: str
    index: int
    inferred_type: str
    role: str
    # Parsed representation of every row's value for this column. Numeric
    # columns hold floats, temporal hold ISO date strings, others hold str.
    parsed_values: list[Any] = field(default_factory=list)
    null_count: int = 0
    unique_count: int = 0
    currency: str | None = None
    is_percentage: bool = False
    date_granularity: str | None = None  # "year" | "month" | "day"
    min_value: float | None = None
    max_value: float | None = None
    mean_value: float | None = None
    sample_values: list[str] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)
    type_confidence: float = 1.0


@dataclass
class TableProfile:
    title: str
    columns: list[ColumnProfile]
    row_count: int
    issues: list[str] = field(default_factory=list)

    def by_role(self, role: str) -> list[ColumnProfile]:
        return [c for c in self.columns if c.role == role]


# --------------------------------------------------------------------------
# Value-level parsing
# --------------------------------------------------------------------------

def _clean(value: str) -> str:
    return (value or "").strip()


def _is_null(value: str) -> bool:
    return _clean(value).lower() in {"", "na", "n/a", "null", "none", "-", "--", "nil", "nan"}


def parse_number(value: str) -> tuple[float | None, str | None, bool]:
    """
    Parses a numeric-looking string, returning (number, currency, is_percentage).

    Handles: thousands separators, currency symbols and codes, percentages,
    parenthesised negatives (accounting convention), and leading +/-.
    Returns (None, ...) when the value isn't actually numeric, rather than
    coercing garbage to 0 the way a naive regex strip would.
    """
    v = _clean(value)
    if not v or _is_null(v):
        return None, None, False

    currency = None
    is_pct = False
    negative = False

    # Accounting negatives: (1,234) means -1234
    if v.startswith("(") and v.endswith(")"):
        negative = True
        v = v[1:-1].strip()

    # Currency symbol prefix/suffix
    for sym, code in CURRENCY_SYMBOLS.items():
        if v.startswith(sym):
            currency = code
            v = v[len(sym):].strip()
            break
        if v.endswith(sym):
            currency = code
            v = v[: -len(sym)].strip()
            break

    # Currency code suffix (e.g. "1500 USDT")
    parts = v.split()
    if len(parts) == 2 and parts[1].upper() in CURRENCY_CODES:
        currency = parts[1].upper()
        v = parts[0]

    if v.endswith("%"):
        is_pct = True
        v = v[:-1].strip()

    if v.startswith("+"):
        v = v[1:]
    if v.startswith("-"):
        negative = True
        v = v[1:]

    # Thousands separators: strip commas or spaces used as group separators.
    # Careful not to destroy European decimal commas ("1.234,56").
    if "," in v and "." in v:
        if v.rindex(",") > v.rindex("."):
            v = v.replace(".", "").replace(",", ".")  # European
        else:
            v = v.replace(",", "")  # US/UK
    elif "," in v:
        # Ambiguous: "1,234" is thousands; "1,23" is likely a decimal comma
        after = v.split(",")[-1]
        v = v.replace(",", "") if len(after) == 3 else v.replace(",", ".")
    v = v.replace(" ", "").replace("_", "")

    if not v or not any(ch.isdigit() for ch in v):
        return None, None, False

    try:
        num = float(v)
    except ValueError:
        return None, None, False

    if negative:
        num = -num
    return num, currency, is_pct


_MONTH_YEAR_RE = re.compile(
    r"^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{4})$", re.I
)
_YEAR_RE = re.compile(r"^(19|20)\d{2}$")
_QUARTER_RE = re.compile(r"^q([1-4])[\s\-]*(\d{4})$", re.I)


def parse_date(value: str) -> tuple[datetime | None, str | None]:
    """
    Parses a date, returning (datetime, granularity). Handles bare years,
    "Mar 2026", "Q1 2026", ISO dates, and common regional formats.
    Granularity matters: plotting monthly data on a daily axis is wrong.
    """
    v = _clean(value)
    if not v or _is_null(v):
        return None, None

    if _YEAR_RE.match(v):
        return datetime(int(v), 1, 1), "year"

    q = _QUARTER_RE.match(v)
    if q:
        quarter, year = int(q.group(1)), int(q.group(2))
        return datetime(year, (quarter - 1) * 3 + 1, 1), "quarter"

    my = _MONTH_YEAR_RE.match(v)
    if my:
        try:
            dt = date_parser.parse(f"1 {my.group(1)} {my.group(2)}")
            return dt, "month"
        except Exception:
            return None, None

    # Reject bare numbers: "2407" is a count, not a date, even though a
    # permissive parser would happily read it as a year.
    if v.replace(".", "").replace(",", "").isdigit():
        return None, None

    try:
        dt = date_parser.parse(v, fuzzy=False)
        granularity = "day"
        if re.match(r"^\d{4}-\d{2}$", v):
            granularity = "month"
        return dt, granularity
    except Exception:
        return None, None


def parse_boolean(value: str) -> bool | None:
    v = _clean(value).lower()
    if v in BOOLEAN_TRUE:
        return True
    if v in BOOLEAN_FALSE:
        return False
    return None


# --------------------------------------------------------------------------
# Column-level inference
# --------------------------------------------------------------------------

def _infer_column(name: str, index: int, values: list[str], row_count: int) -> ColumnProfile:
    non_null = [v for v in values if not _is_null(v)]
    null_count = len(values) - len(non_null)

    profile = ColumnProfile(
        name=name,
        index=index,
        inferred_type=TYPE_EMPTY,
        role=ROLE_TEXT,
        null_count=null_count,
        unique_count=len(set(_clean(v) for v in non_null)),
        sample_values=[_clean(v) for v in non_null[:5]],
    )

    if not non_null:
        profile.issues.append("Column is entirely empty.")
        return profile

    name_lower = name.lower()
    sample = non_null[: min(200, len(non_null))]

    # Try each type across the sample and measure how much of it parses.
    bool_hits = sum(1 for v in sample if parse_boolean(v) is not None)
    num_results = [parse_number(v) for v in sample]
    num_hits = sum(1 for n, _, _ in num_results if n is not None)
    date_results = [parse_date(v) for v in sample]
    date_hits = sum(1 for d, _ in date_results if d is not None)

    total = len(sample)
    bool_ratio = bool_hits / total
    num_ratio = num_hits / total
    date_ratio = date_hits / total

    # Booleans first: a column of "yes/no" is boolean, not category.
    if bool_ratio >= 0.9 and profile.unique_count <= 3:
        profile.inferred_type = TYPE_BOOLEAN
        profile.role = ROLE_CATEGORICAL
        profile.parsed_values = [parse_boolean(v) for v in values]
        profile.type_confidence = bool_ratio
        return profile

    # Dates: prefer date over number when the column name hints temporal,
    # or when dates parse well and numbers don't (e.g. "2026-03-15").
    name_is_temporal = any(h in name_lower for h in TEMPORAL_NAME_HINTS)
    if date_ratio >= 0.8 and (name_is_temporal or date_ratio > num_ratio):
        granularities = [g for _, g in date_results if g]
        profile.inferred_type = TYPE_DATE
        profile.role = ROLE_TEMPORAL
        profile.date_granularity = (
            max(set(granularities), key=granularities.count) if granularities else "day"
        )
        profile.parsed_values = [
            (parse_date(v)[0].isoformat() if parse_date(v)[0] else None) for v in values
        ]
        profile.type_confidence = date_ratio
        if date_ratio < 1.0:
            profile.issues.append(
                f"{round((1 - date_ratio) * 100)}% of values could not be parsed as dates."
            )
        return profile

    # Numeric family
    if num_ratio >= 0.8:
        currencies = [c for _, c, _ in num_results if c]
        pct_flags = [p for _, _, p in num_results if p]
        numbers = [n for n, _, _ in num_results if n is not None]

        profile.currency = max(set(currencies), key=currencies.count) if currencies else None
        profile.is_percentage = len(pct_flags) > total * 0.5

        if profile.is_percentage:
            profile.inferred_type = TYPE_PERCENTAGE
        elif profile.currency:
            profile.inferred_type = TYPE_CURRENCY
        elif all(float(n).is_integer() for n in numbers):
            profile.inferred_type = TYPE_INTEGER
        else:
            profile.inferred_type = TYPE_DECIMAL

        # An all-integer column with near-unique values and an id-ish name
        # is a key, not a measure. Plotting it would be meaningless.
        looks_like_id = (
            any(h == name_lower or name_lower.endswith(f"_{h}") or name_lower.endswith(f" {h}")
                for h in IDENTIFIER_NAME_HINTS)
            and profile.unique_count > len(non_null) * 0.9
        )
        if looks_like_id:
            profile.inferred_type = TYPE_IDENTIFIER
            profile.role = ROLE_IDENTIFIER
        else:
            profile.role = ROLE_MEASURE

        parsed_full = [parse_number(v)[0] for v in values]
        profile.parsed_values = parsed_full
        valid = [n for n in parsed_full if n is not None]
        if valid:
            profile.min_value = min(valid)
            profile.max_value = max(valid)
            profile.mean_value = sum(valid) / len(valid)
            if len(valid) > 4:
                _flag_outliers(profile, valid)
        profile.type_confidence = num_ratio
        if num_ratio < 1.0:
            profile.issues.append(
                f"{round((1 - num_ratio) * 100)}% of values are not numeric and were treated as missing."
            )
        return profile

    # Non-numeric, non-date: category vs identifier vs free text.
    #
    # Uniqueness alone is NOT enough to call something an identifier. A
    # breakdown table ("Volume by Transaction Type") legitimately has a
    # unique label on every row, and misreading those labels as keys means
    # refusing to chart exactly the data people most want charted. So we
    # require corroborating evidence: an id-ish column name, or values that
    # look machine-generated (uuids, hashes, long digit strings) rather
    # than human-readable labels.
    unique_ratio = profile.unique_count / len(non_null)
    avg_len = sum(len(_clean(v)) for v in non_null) / len(non_null)
    cleaned_values = [_clean(v) for v in non_null]

    name_is_id = any(
        name_lower == h or name_lower.endswith(f"_{h}") or name_lower.endswith(f" {h}")
        or name_lower.startswith(f"{h}_")
        for h in IDENTIFIER_NAME_HINTS
    )
    looks_machine_generated = _looks_machine_generated(cleaned_values)

    if unique_ratio > 0.95 and (name_is_id or looks_machine_generated):
        profile.inferred_type = TYPE_IDENTIFIER
        profile.role = ROLE_IDENTIFIER
    elif avg_len > 60:
        profile.inferred_type = TYPE_TEXT
        profile.role = ROLE_TEXT
    else:
        profile.inferred_type = TYPE_CATEGORY
        profile.role = ROLE_CATEGORICAL

    profile.parsed_values = [_clean(v) if not _is_null(v) else None for v in values]
    profile.type_confidence = 1.0 - (num_ratio + date_ratio) / 2

    if null_count > row_count * 0.3:
        profile.issues.append(f"{round(null_count / row_count * 100)}% of values are missing.")

    return profile


def _looks_machine_generated(values: list[str]) -> bool:
    """
    Distinguishes real identifiers (uuids, hashes, order numbers) from
    human-readable category labels. Machine keys are long, lack spaces, and
    are dominated by hex or digits; "Fiat Withdrawal" is none of those.
    """
    if not values:
        return False
    sample = values[: min(50, len(values))]
    hits = 0
    for v in sample:
        if " " in v:
            continue  # labels have spaces; keys generally don't
        if len(v) >= 16 and sum(ch.isalnum() for ch in v) / max(len(v), 1) > 0.9:
            hits += 1
        elif len(v) >= 8 and all(ch in "0123456789abcdefABCDEF-" for ch in v):
            hits += 1
        elif v.isdigit() and len(v) >= 6:
            hits += 1
    return hits / len(sample) > 0.7


def _flag_outliers(profile: ColumnProfile, values: list[float]) -> None:
    """Flags extreme values using the IQR rule, so a bad row is visible
    rather than silently distorting the chart's scale."""
    try:
        quantiles = statistics.quantiles(values, n=4)
        q1, q3 = quantiles[0], quantiles[2]
        iqr = q3 - q1
        if iqr == 0:
            return
        low, high = q1 - 3 * iqr, q3 + 3 * iqr
        outliers = [v for v in values if v < low or v > high]
        if outliers:
            profile.issues.append(
                f"{len(outliers)} extreme value(s) detected (e.g. {outliers[0]:,.2f}); these will dominate a chart's scale."
            )
    except Exception:
        pass


def profile_table(title: str, columns: list[str], rows: list[list[str]]) -> TableProfile:
    """Builds a full profile of a table: every column typed and given a role."""
    column_profiles: list[ColumnProfile] = []
    for idx, name in enumerate(columns):
        values = [(row[idx] if idx < len(row) else "") for row in rows]
        column_profiles.append(_infer_column(name, idx, values, len(rows)))

    issues: list[str] = []
    if not rows:
        issues.append("Table has no data rows.")

    # Duplicate row detection
    seen, dupes = set(), 0
    for row in rows:
        key = tuple(_clean(c) for c in row)
        if key in seen:
            dupes += 1
        seen.add(key)
    if dupes:
        issues.append(f"{dupes} duplicate row(s) found.")

    # Measure-name hints can rescue a column that looked categorical
    for cp in column_profiles:
        if cp.role == ROLE_CATEGORICAL and any(h in cp.name.lower() for h in MEASURE_NAME_HINTS):
            if cp.inferred_type in (TYPE_INTEGER, TYPE_DECIMAL, TYPE_CURRENCY, TYPE_PERCENTAGE):
                cp.role = ROLE_MEASURE

    if not any(c.role == ROLE_MEASURE for c in column_profiles):
        issues.append("No numeric measure column detected, charts will be limited to counts.")

    return TableProfile(title=title, columns=column_profiles, row_count=len(rows), issues=issues)


def column_profile_to_dict(c: ColumnProfile) -> dict:
    return {
        "name": c.name,
        "index": c.index,
        "type": c.inferred_type,
        "role": c.role,
        "null_count": c.null_count,
        "unique_count": c.unique_count,
        "currency": c.currency,
        "is_percentage": c.is_percentage,
        "date_granularity": c.date_granularity,
        "min": c.min_value,
        "max": c.max_value,
        "mean": c.mean_value,
        "sample_values": c.sample_values,
        "issues": c.issues,
        "confidence": round(c.type_confidence, 2),
    }


def table_profile_to_dict(t: TableProfile) -> dict:
    return {
        "title": t.title,
        "row_count": t.row_count,
        "columns": [column_profile_to_dict(c) for c in t.columns],
        "issues": t.issues,
    }
