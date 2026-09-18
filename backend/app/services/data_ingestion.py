"""
Data ingestion: turns arbitrary uploaded/pasted data into structured tables.

The central design assumption here is that we do NOT know the shape of what
the user gives us. Real exports are messy: multiple tables in one file,
title rows, padded columns, merged headers, footnotes, blank separators,
mixed delimiters, nested JSON, PDF tables split across pages. A naive
"first row is headers" parser produces garbage on most real input, which is
exactly the failure this module exists to prevent.

Every parser here returns a list of RawTable, because one file legitimately
often contains several tables. Downstream, the user picks which one(s) to
work with, and schema inference figures out what each column actually is.

Supported inputs:
  - CSV / TSV / semicolon-delimited (delimiter auto-detected)
  - JSON (array of objects, object of arrays, nested, or JSON Lines)
  - Excel (.xlsx / .xlsm, every sheet, multiple tables per sheet)
  - PDF (table extraction via pdfplumber, tables stitched across pages)
"""
import csv
import io
import json
import re
from dataclasses import dataclass, field
from typing import Any

import pandas as pd


@dataclass
class RawTable:
    """A single detected table, before any type inference."""
    title: str
    columns: list[str]
    rows: list[list[str]]
    source: str  # e.g. "sheet: Q3 Summary", "page 2", "section 1"
    confidence: float = 1.0  # how confident we are this is a real table
    notes: list[str] = field(default_factory=list)

    @property
    def row_count(self) -> int:
        return len(self.rows)

    @property
    def column_count(self) -> int:
        return len(self.columns)


# --------------------------------------------------------------------------
# Delimited text (CSV / TSV / etc.)
# --------------------------------------------------------------------------

def _sniff_delimiter(sample: str) -> str:
    """
    Detects the delimiter rather than assuming comma. Falls back to counting
    candidate characters per line when csv.Sniffer fails, which it often
    does on messy real-world exports.
    """
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        return dialect.delimiter
    except Exception:
        pass

    candidates = [",", ";", "\t", "|"]
    lines = [l for l in sample.split("\n")[:20] if l.strip()]
    if not lines:
        return ","

    best, best_score = ",", -1.0
    for cand in candidates:
        counts = [line.count(cand) for line in lines]
        if not counts or max(counts) == 0:
            continue
        # A good delimiter appears consistently across lines. Score on
        # median count penalised by variance, so a character that appears
        # erratically (like a comma inside prose) loses to a real delimiter.
        avg = sum(counts) / len(counts)
        variance = sum((c - avg) ** 2 for c in counts) / len(counts)
        score = avg - variance
        if score > best_score:
            best, best_score = cand, score
    return best


def _parse_delimited_lines(text: str, delimiter: str) -> list[list[str]]:
    """Proper RFC-4180-ish parsing: handles quoted fields containing delimiters."""
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    out = []
    for row in reader:
        out.append([cell.strip() for cell in row])
    return out


def _is_effectively_blank(row: list[str]) -> bool:
    return all(c.strip() == "" for c in row)


def _looks_like_title_row(row: list[str]) -> bool:
    """
    A title row has content in the first cell and nothing meaningful after.
    Covers both bare "Title" lines and exports that pad every row to the
    sheet width, producing "Title,,,,".
    """
    if not row or not row[0].strip():
        return False
    return all(c.strip() == "" for c in row[1:])


def _score_header_row(row: list[str], following_rows: list[list[str]]) -> float:
    """
    Estimates how likely a row is to be a header rather than data. Headers
    tend to be all-text, non-empty, unique, and sit above rows that contain
    numbers. This lets us find the header even when a table starts with
    junk rows above it.
    """
    cells = [c.strip() for c in row]
    non_empty = [c for c in cells if c]
    if len(non_empty) < 2:
        return 0.0

    score = 0.0
    # Headers are rarely numeric
    numeric_cells = sum(1 for c in non_empty if _looks_numeric(c))
    score += (1.0 - numeric_cells / len(non_empty)) * 2.0
    # Headers are usually unique
    if len(set(non_empty)) == len(non_empty):
        score += 1.0
    # Headers are usually fully populated
    score += len(non_empty) / max(len(cells), 1)
    # Rows below a header usually contain numbers
    if following_rows:
        sample = following_rows[: min(5, len(following_rows))]
        numeric_below = sum(
            1 for r in sample for c in r if c.strip() and _looks_numeric(c.strip())
        )
        if numeric_below > 0:
            score += 1.0
    return score


_NUMERIC_RE = re.compile(r"^[\s]*[-+(]?[\s]*[$€£₦¥]?[\s]*[\d,.\s]+[%)]?[\s]*$")


def _looks_numeric(value: str) -> bool:
    if not value or not value.strip():
        return False
    v = value.strip()
    if not _NUMERIC_RE.match(v):
        return False
    # Must contain at least one digit
    return any(ch.isdigit() for ch in v)


def parse_delimited(text: str) -> list[RawTable]:
    """
    Parses delimited text into one or more tables. Handles the common real
    export shape of several tables stacked in one file, each optionally
    preceded by a title row and separated by blank lines.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    delimiter = _sniff_delimiter(text[:5000])
    all_rows = _parse_delimited_lines(text, delimiter)
    if not all_rows:
        return []

    tables: list[RawTable] = []
    i = 0
    n = len(all_rows)
    pending_title: str | None = None
    blank_run = 0

    while i < n:
        row = all_rows[i]

        if _is_effectively_blank(row):
            blank_run += 1
            i += 1
            continue

        if _looks_like_title_row(row):
            # Only treat as a title if a plausible header follows.
            j = i + 1
            while j < n and _is_effectively_blank(all_rows[j]):
                j += 1
            if j < n and len([c for c in all_rows[j] if c.strip()]) > 1:
                pending_title = row[0].strip()
                i = j
                blank_run = 0
                continue

        # This row starts a table. Find the best header row among this row
        # and the next couple, in case of junk/preamble lines.
        header_idx = i
        best_score = _score_header_row(all_rows[i], all_rows[i + 1 : i + 6])
        for candidate in range(i + 1, min(i + 3, n)):
            if _is_effectively_blank(all_rows[candidate]):
                continue
            s = _score_header_row(all_rows[candidate], all_rows[candidate + 1 : candidate + 6])
            if s > best_score + 0.5:
                best_score, header_idx = s, candidate

        header = [c.strip() for c in all_rows[header_idx]]
        # Trim trailing empty header cells (padding)
        while header and not header[-1]:
            header.pop()
        if not header:
            i += 1
            continue

        # Fill any interior blank header cells so columns stay addressable
        header = [h if h else f"Column {idx + 1}" for idx, h in enumerate(header)]

        # Collect data rows until a blank gap followed by a new title, or a
        # row whose shape clearly differs (a new table with different width).
        data_rows: list[list[str]] = []
        k = header_idx + 1
        consecutive_blanks = 0
        while k < n:
            r = all_rows[k]
            if _is_effectively_blank(r):
                consecutive_blanks += 1
                k += 1
                # A blank line only ends the table if a title row follows.
                nxt = k
                while nxt < n and _is_effectively_blank(all_rows[nxt]):
                    nxt += 1
                if nxt < n and _looks_like_title_row(all_rows[nxt]):
                    break
                continue
            consecutive_blanks = 0
            if _looks_like_title_row(r):
                break
            # Normalise row width to the header
            trimmed = [c.strip() for c in r][: len(header)]
            while len(trimmed) < len(header):
                trimmed.append("")
            data_rows.append(trimmed)
            k += 1

        title = pending_title or (f"Table {len(tables) + 1}")
        notes = []
        if header_idx > i:
            notes.append(f"Skipped {header_idx - i} preamble row(s) above the header.")
        tables.append(RawTable(
            title=title,
            columns=header,
            rows=data_rows,
            source="pasted/uploaded text",
            notes=notes,
        ))
        pending_title = None
        i = k

    return [t for t in tables if t.rows or t.columns]


# --------------------------------------------------------------------------
# JSON
# --------------------------------------------------------------------------

def _flatten_record(obj: Any, prefix: str = "", out: dict | None = None) -> dict:
    """
    Flattens nested objects into dotted keys so nested JSON becomes a usable
    flat table (e.g. {"user": {"name": "x"}} -> {"user.name": "x"}).
    Lists of scalars are joined; lists of objects are left for the caller to
    handle as a separate table.
    """
    if out is None:
        out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, dict):
                _flatten_record(v, key, out)
            elif isinstance(v, list):
                if v and all(not isinstance(x, (dict, list)) for x in v):
                    out[key] = ", ".join(str(x) for x in v)
                else:
                    out[key] = f"[{len(v)} items]"
            else:
                out[key] = v
    else:
        out[prefix or "value"] = obj
    return out


def parse_json(text: str) -> list[RawTable]:
    """
    Handles the realistic JSON shapes:
      - array of objects (the common case)
      - object whose values are arrays of objects (several named tables)
      - object of parallel arrays (columnar format)
      - JSON Lines (one object per line)
      - single object (becomes a two-column key/value table)
    """
    text = text.strip()
    parsed: Any

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Try JSON Lines
        records = []
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                raise ValueError("Could not parse this as JSON or JSON Lines.")
        if not records:
            raise ValueError("No JSON records found.")
        parsed = records

    tables: list[RawTable] = []

    def table_from_records(records: list, title: str) -> RawTable | None:
        flat = [_flatten_record(r) for r in records if isinstance(r, (dict, list)) or r is not None]
        if not flat:
            return None
        # Union of all keys, preserving first-seen order
        columns: list[str] = []
        for rec in flat:
            for k in rec.keys():
                if k not in columns:
                    columns.append(k)
        rows = [[_stringify(rec.get(c, "")) for c in columns] for rec in flat]
        return RawTable(title=title, columns=columns, rows=rows, source="JSON")

    if isinstance(parsed, list):
        if parsed and all(isinstance(r, dict) for r in parsed):
            t = table_from_records(parsed, "Imported data")
            if t:
                tables.append(t)
        else:
            # Array of scalars
            tables.append(RawTable(
                title="Imported data",
                columns=["value"],
                rows=[[_stringify(v)] for v in parsed],
                source="JSON",
            ))

    elif isinstance(parsed, dict):
        # Object of arrays-of-objects -> several named tables
        nested_tables = {
            k: v for k, v in parsed.items()
            if isinstance(v, list) and v and all(isinstance(r, dict) for r in v)
        }
        if nested_tables:
            for name, records in nested_tables.items():
                t = table_from_records(records, name)
                if t:
                    tables.append(t)

        # Object of parallel arrays (columnar)
        parallel = {
            k: v for k, v in parsed.items()
            if isinstance(v, list) and v and all(not isinstance(x, (dict, list)) for x in v)
        }
        if parallel and len(set(len(v) for v in parallel.values())) == 1:
            columns = list(parallel.keys())
            length = len(next(iter(parallel.values())))
            rows = [[_stringify(parallel[c][i]) for c in columns] for i in range(length)]
            tables.append(RawTable(title="Imported data", columns=columns, rows=rows, source="JSON"))

        # Plain flat object -> key/value table
        if not tables:
            flat = _flatten_record(parsed)
            tables.append(RawTable(
                title="Imported data",
                columns=["Field", "Value"],
                rows=[[k, _stringify(v)] for k, v in flat.items()],
                source="JSON",
            ))

    return tables


def _stringify(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    return str(v)


# --------------------------------------------------------------------------
# Excel
# --------------------------------------------------------------------------

def parse_excel(file_bytes: bytes) -> list[RawTable]:
    """
    Reads every sheet. Within each sheet, detects separate tables the same
    way as delimited text (blank-row separated blocks with optional titles),
    since a single sheet very often holds several stacked tables.
    """
    tables: list[RawTable] = []
    xls = pd.ExcelFile(io.BytesIO(file_bytes))

    for sheet_name in xls.sheet_names:
        # header=None so we can do our own header detection rather than
        # trusting that row 0 is the header, which is often wrong.
        df = pd.read_excel(xls, sheet_name=sheet_name, header=None, dtype=str)
        if df.empty:
            continue
        grid = df.fillna("").astype(str).values.tolist()
        # Reuse the delimited-text table splitter by re-serialising the grid
        as_text = "\n".join(
            ",".join('"' + str(c).replace('"', '""') + '"' for c in row) for row in grid
        )
        sheet_tables = parse_delimited(as_text)
        for t in sheet_tables:
            t.source = f"sheet: {sheet_name}"
            if t.title.startswith("Table ") and len(sheet_tables) == 1:
                t.title = sheet_name
            tables.append(t)

    return tables


# --------------------------------------------------------------------------
# PDF
# --------------------------------------------------------------------------

def parse_pdf(file_bytes: bytes) -> list[RawTable]:
    """
    Extracts tables from a PDF. Tables that continue across a page break
    (same column count and matching header) are stitched back together,
    because a financial statement split over three pages should arrive as
    one table, not three.
    """
    import pdfplumber

    extracted: list[tuple[int, list[list[str]]]] = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables():
                cleaned = [
                    [(cell or "").strip().replace("\n", " ") for cell in row]
                    for row in table
                    if row is not None
                ]
                cleaned = [r for r in cleaned if any(c for c in r)]
                if len(cleaned) >= 2:
                    extracted.append((page_number, cleaned))

    tables: list[RawTable] = []
    for page_number, grid in extracted:
        header = grid[0]
        body = grid[1:]
        header = [h if h else f"Column {i + 1}" for i, h in enumerate(header)]

        # Stitch onto the previous table if it looks like a continuation:
        # same width, and this grid's first row repeats the previous header.
        if tables:
            prev = tables[-1]
            if len(header) == len(prev.columns):
                if header == prev.columns:
                    prev.rows.extend([_pad(r, len(prev.columns)) for r in body])
                    prev.notes.append(f"Continued from page {page_number}.")
                    continue
                # Headerless continuation: same width, first row is data
                if not any(_looks_like_header_cell(c) for c in header):
                    prev.rows.extend([_pad(r, len(prev.columns)) for r in grid])
                    prev.notes.append(f"Continued from page {page_number}.")
                    continue

        tables.append(RawTable(
            title=f"Table from page {page_number}",
            columns=header,
            rows=[_pad(r, len(header)) for r in body],
            source=f"page {page_number}",
            notes=[],
        ))

    return tables


def _pad(row: list[str], width: int) -> list[str]:
    r = list(row[:width])
    while len(r) < width:
        r.append("")
    return r


def _looks_like_header_cell(cell: str) -> bool:
    c = cell.strip()
    return bool(c) and not _looks_numeric(c)


# --------------------------------------------------------------------------
# Dispatcher
# --------------------------------------------------------------------------

def ingest(
    *,
    text: str | None = None,
    file_bytes: bytes | None = None,
    filename: str | None = None,
) -> list[RawTable]:
    """
    Single entry point. Detects the format from the filename when a file is
    given, or from the content shape when raw text is pasted, so the user
    never has to pick the right parser from a dropdown.
    """
    if file_bytes is not None and filename:
        lower = filename.lower()
        if lower.endswith((".xlsx", ".xlsm", ".xltx")):
            return parse_excel(file_bytes)
        if lower.endswith(".pdf"):
            return parse_pdf(file_bytes)
        if lower.endswith(".json"):
            return parse_json(file_bytes.decode("utf-8", errors="ignore"))
        # Fall through: treat as delimited text
        return parse_delimited(file_bytes.decode("utf-8", errors="ignore"))

    if text is None:
        raise ValueError("Nothing to ingest.")

    stripped = text.strip()
    if stripped.startswith(("[", "{")):
        try:
            return parse_json(stripped)
        except ValueError:
            pass  # Not valid JSON after all, try delimited

    return parse_delimited(text)


def raw_table_to_dict(t: RawTable) -> dict:
    return {
        "title": t.title,
        "columns": t.columns,
        "rows": t.rows,
        "source": t.source,
        "row_count": t.row_count,
        "column_count": t.column_count,
        "notes": t.notes,
    }
