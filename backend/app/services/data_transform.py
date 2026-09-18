"""
Data transformation: reshaping a table so it can actually be charted.

Raw imported data rarely arrives in the shape a chart needs. A transaction
log has one row per transaction, but the chart wants revenue per month. A
status breakdown repeats the total on every row. A category list has 40
entries where only the top 10 are legible. This module does that reshaping
explicitly, so the user can see and change it, rather than a chart library
silently plotting the wrong thing.

Operations:
  - aggregate:  group by dimension(s), apply sum/avg/count/min/max
  - pivot:      long -> wide (a category's values become columns)
  - unpivot:    wide -> long (columns become category/value pairs)
  - filter:     keep rows matching a condition
  - top_n:      keep the largest N by a measure, group the rest as "Other"
  - sort:       order by a column
  - derive:     add a computed column (share of total, running total, etc.)
"""
from dataclasses import dataclass
from typing import Any

from app.services.schema_inference import (
    TableProfile,
    parse_number,
    ROLE_MEASURE,
)

AGGREGATIONS = {
    "sum": lambda vals: sum(vals),
    "avg": lambda vals: sum(vals) / len(vals) if vals else 0,
    "count": lambda vals: len(vals),
    "min": lambda vals: min(vals) if vals else 0,
    "max": lambda vals: max(vals) if vals else 0,
    "median": lambda vals: sorted(vals)[len(vals) // 2] if vals else 0,
}


@dataclass
class TransformResult:
    columns: list[str]
    rows: list[list[Any]]
    description: str  # plain-language account of what was done, shown to the user
    notes: list[str]


def _column_index(columns: list[str], name: str) -> int:
    try:
        return columns.index(name)
    except ValueError:
        raise ValueError(f"Column '{name}' not found. Available: {', '.join(columns)}")


def _numeric(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if value is None:
        return None
    n, _, _ = parse_number(str(value))
    return n


def aggregate(
    columns: list[str],
    rows: list[list[Any]],
    group_by: list[str],
    measure: str | None,
    how: str = "sum",
) -> TransformResult:
    """
    Groups rows and aggregates a measure. This is what turns a row-per-event
    log into the per-period or per-category summary a chart needs.

    measure=None with how="count" counts rows per group, which is the right
    operation when the data has no numeric column at all.
    """
    if how not in AGGREGATIONS:
        raise ValueError(f"Unknown aggregation '{how}'. Use one of: {', '.join(AGGREGATIONS)}")

    group_indices = [_column_index(columns, g) for g in group_by]
    measure_index = _column_index(columns, measure) if measure else None

    buckets: dict[tuple, list[float]] = {}
    order: list[tuple] = []
    for row in rows:
        key = tuple(str(row[i]) if i < len(row) else "" for i in group_indices)
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        if measure_index is not None:
            val = _numeric(row[measure_index] if measure_index < len(row) else None)
            if val is not None:
                buckets[key].append(val)
        else:
            buckets[key].append(1.0)

    fn = AGGREGATIONS[how]
    out_columns = list(group_by) + [f"{how}({measure})" if measure else "count"]
    out_rows = [list(key) + [round(fn(buckets[key]), 4)] for key in order]

    dropped = len(rows) - len(out_rows)
    description = (
        f"Grouped {len(rows)} rows by {', '.join(group_by)} "
        f"and took the {how} of {measure or 'row count'}, giving {len(out_rows)} groups."
    )
    notes = []
    if dropped > 0:
        notes.append(f"{len(rows)} original rows collapsed into {len(out_rows)} groups.")

    return TransformResult(columns=out_columns, rows=out_rows, description=description, notes=notes)


def top_n(
    columns: list[str],
    rows: list[list[Any]],
    measure: str,
    n: int = 10,
    group_remainder: bool = True,
    label_column: str | None = None,
) -> TransformResult:
    """
    Keeps the largest N rows by a measure. The remainder is grouped into a
    single "Other" row rather than silently dropped, because a chart that
    hides 30 categories without saying so is misleading.
    """
    measure_index = _column_index(columns, measure)
    label_index = _column_index(columns, label_column) if label_column else 0

    scored = []
    for row in rows:
        val = _numeric(row[measure_index] if measure_index < len(row) else None)
        scored.append((val if val is not None else float("-inf"), row))
    scored.sort(key=lambda t: -t[0])

    kept = [r for _, r in scored[:n]]
    remainder = [(v, r) for v, r in scored[n:] if v != float("-inf")]

    notes = []
    if remainder and group_remainder:
        other_total = sum(v for v, _ in remainder)
        other_row: list[Any] = ["" for _ in columns]
        other_row[label_index] = f"Other ({len(remainder)})"
        other_row[measure_index] = round(other_total, 4)
        kept.append(other_row)
        notes.append(
            f"{len(remainder)} smaller categories grouped into 'Other', totalling {other_total:,.2f}."
        )
    elif remainder:
        notes.append(f"{len(remainder)} rows below the top {n} were excluded.")

    return TransformResult(
        columns=list(columns),
        rows=kept,
        description=f"Kept the top {n} rows by {measure}, sorted highest first.",
        notes=notes,
    )


def pivot(
    columns: list[str],
    rows: list[list[Any]],
    index: str,
    pivot_on: str,
    measure: str,
    how: str = "sum",
) -> TransformResult:
    """
    Long to wide. Turns each distinct value of `pivot_on` into its own
    column, which is what a grouped/stacked bar or multi-series line needs.

    e.g. rows of (month, channel, revenue) become one row per month with a
    column per channel.
    """
    index_i = _column_index(columns, index)
    pivot_i = _column_index(columns, pivot_on)
    measure_i = _column_index(columns, measure)

    pivot_values: list[str] = []
    grid: dict[str, dict[str, list[float]]] = {}
    index_order: list[str] = []

    for row in rows:
        idx_val = str(row[index_i]) if index_i < len(row) else ""
        piv_val = str(row[pivot_i]) if pivot_i < len(row) else ""
        num = _numeric(row[measure_i] if measure_i < len(row) else None)
        if piv_val not in pivot_values:
            pivot_values.append(piv_val)
        if idx_val not in grid:
            grid[idx_val] = {}
            index_order.append(idx_val)
        grid[idx_val].setdefault(piv_val, []).append(num if num is not None else 0.0)

    fn = AGGREGATIONS.get(how, AGGREGATIONS["sum"])
    out_columns = [index] + pivot_values
    out_rows = []
    for idx_val in index_order:
        row_out: list[Any] = [idx_val]
        for pv in pivot_values:
            vals = grid[idx_val].get(pv, [])
            row_out.append(round(fn(vals), 4) if vals else 0)
        out_rows.append(row_out)

    notes = []
    if len(pivot_values) > 12:
        notes.append(
            f"{len(pivot_values)} columns were created. That's likely too many series to chart legibly; "
            "consider filtering or taking the top values of "
            f"{pivot_on} first."
        )

    return TransformResult(
        columns=out_columns,
        rows=out_rows,
        description=(
            f"Pivoted {pivot_on} into columns, with {index} as rows and the {how} of {measure} as values."
        ),
        notes=notes,
    )


def unpivot(
    columns: list[str],
    rows: list[list[Any]],
    keep: list[str],
    melt: list[str],
    variable_name: str = "Series",
    value_name: str = "Value",
) -> TransformResult:
    """
    Wide to long. Turns several measure columns into category/value pairs,
    which is what a grouped bar or a coloured multi-series chart needs when
    the source has one column per series.
    """
    keep_indices = [_column_index(columns, k) for k in keep]
    melt_indices = [(m, _column_index(columns, m)) for m in melt]

    out_columns = list(keep) + [variable_name, value_name]
    out_rows: list[list[Any]] = []
    for row in rows:
        base = [row[i] if i < len(row) else "" for i in keep_indices]
        for name, idx in melt_indices:
            out_rows.append(base + [name, row[idx] if idx < len(row) else ""])

    return TransformResult(
        columns=out_columns,
        rows=out_rows,
        description=(
            f"Reshaped {len(melt)} measure column(s) into '{variable_name}'/'{value_name}' pairs, "
            f"turning {len(rows)} rows into {len(out_rows)}."
        ),
        notes=[],
    )


def filter_rows(
    columns: list[str],
    rows: list[list[Any]],
    column: str,
    operator: str,
    value: str,
) -> TransformResult:
    """Keeps rows matching a condition. Operators: =, !=, >, <, >=, <=, contains."""
    idx = _column_index(columns, column)
    numeric_target = _numeric(value)

    def matches(row: list[Any]) -> bool:
        cell = row[idx] if idx < len(row) else ""
        cell_str = str(cell).strip()
        cell_num = _numeric(cell)

        if operator == "=":
            return cell_str.lower() == str(value).strip().lower()
        if operator == "!=":
            return cell_str.lower() != str(value).strip().lower()
        if operator == "contains":
            return str(value).strip().lower() in cell_str.lower()
        if cell_num is None or numeric_target is None:
            return False
        if operator == ">":
            return cell_num > numeric_target
        if operator == "<":
            return cell_num < numeric_target
        if operator == ">=":
            return cell_num >= numeric_target
        if operator == "<=":
            return cell_num <= numeric_target
        raise ValueError(f"Unknown operator '{operator}'.")

    kept = [r for r in rows if matches(r)]
    return TransformResult(
        columns=list(columns),
        rows=kept,
        description=f"Kept rows where {column} {operator} {value}.",
        notes=[f"{len(rows) - len(kept)} row(s) filtered out."] if len(kept) < len(rows) else [],
    )


def sort_rows(
    columns: list[str], rows: list[list[Any]], column: str, descending: bool = True
) -> TransformResult:
    idx = _column_index(columns, column)

    def key(row: list[Any]):
        cell = row[idx] if idx < len(row) else ""
        num = _numeric(cell)
        # Numbers sort numerically, text alphabetically, nulls last.
        return (0, -num if descending else num, "") if num is not None else (1, 0, str(cell).lower())

    ordered = sorted(rows, key=key)
    return TransformResult(
        columns=list(columns),
        rows=ordered,
        description=f"Sorted by {column}, {'highest' if descending else 'lowest'} first.",
        notes=[],
    )


def derive_share(
    columns: list[str], rows: list[list[Any]], measure: str, new_column: str = "Share %"
) -> TransformResult:
    """Adds each row's share of the measure's total, so a breakdown can be
    read as proportions without the user doing arithmetic by hand."""
    idx = _column_index(columns, measure)
    values = [_numeric(r[idx] if idx < len(r) else None) or 0.0 for r in rows]
    total = sum(values)
    if total == 0:
        raise ValueError(f"Cannot compute share: {measure} totals zero.")

    out_rows = [list(r) + [round(v / total * 100, 2)] for r, v in zip(rows, values)]
    return TransformResult(
        columns=list(columns) + [new_column],
        rows=out_rows,
        description=f"Added {new_column}, each row's percentage of the {measure} total ({total:,.2f}).",
        notes=[],
    )


def derive_running_total(
    columns: list[str], rows: list[list[Any]], measure: str, new_column: str | None = None
) -> TransformResult:
    """Adds a cumulative total, which turns a periodic measure into a
    growth curve without changing the underlying figures."""
    idx = _column_index(columns, measure)
    name = new_column or f"Cumulative {measure}"
    running = 0.0
    out_rows = []
    for r in rows:
        val = _numeric(r[idx] if idx < len(r) else None) or 0.0
        running += val
        out_rows.append(list(r) + [round(running, 4)])
    return TransformResult(
        columns=list(columns) + [name],
        rows=out_rows,
        description=f"Added {name}, a running total of {measure} down the rows.",
        notes=[],
    )


def suggest_transforms(profile: TableProfile) -> list[dict]:
    """
    Proposes transforms that would genuinely improve this specific table,
    based on its inferred shape. Shown to the user as one-click options
    rather than requiring them to know what a pivot is.
    """
    suggestions: list[dict] = []
    measures = profile.by_role(ROLE_MEASURE)
    categoricals = [c for c in profile.columns if c.role == "categorical"]
    temporal = [c for c in profile.columns if c.role == "temporal"]

    # Too many categories to chart legibly
    for cat in categoricals:
        if cat.unique_count > 12 and measures:
            suggestions.append({
                "op": "top_n",
                "label": f"Show top 10 {cat.name} by {measures[0].name}",
                "reason": f"{cat.name} has {cat.unique_count} distinct values, too many to read in one chart.",
                "params": {"measure": measures[0].name, "n": 10, "label_column": cat.name},
            })

    # Repeated dimension values mean the table needs aggregating first
    for cat in categoricals:
        if cat.unique_count < profile.row_count * 0.6 and measures and profile.row_count > 6:
            suggestions.append({
                "op": "aggregate",
                "label": f"Total {measures[0].name} per {cat.name}",
                "reason": (
                    f"{cat.name} repeats across rows, so the raw table double-counts in a chart. "
                    "Grouping first gives one bar per category."
                ),
                "params": {"group_by": [cat.name], "measure": measures[0].name, "how": "sum"},
            })

    # A breakdown without proportions
    if measures and categoricals and not any("share" in m.name.lower() or m.is_percentage for m in measures):
        suggestions.append({
            "op": "derive_share",
            "label": f"Add each row's share of total {measures[0].name}",
            "reason": "Proportions make a breakdown easier to read than raw totals alone.",
            "params": {"measure": measures[0].name},
        })

    # Time series without cumulative view
    if temporal and measures:
        suggestions.append({
            "op": "derive_running_total",
            "label": f"Add cumulative {measures[0].name}",
            "reason": "A running total shows total growth, which a per-period figure hides.",
            "params": {"measure": measures[0].name},
        })

    # Wide format that should be long for multi-series charting
    if len(measures) >= 3 and (temporal or categoricals):
        keep = (temporal or categoricals)[0].name
        suggestions.append({
            "op": "unpivot",
            "label": f"Reshape {len(measures)} measure columns into one series column",
            "reason": (
                "With several measure columns, reshaping to long format lets one chart show all series "
                "with a colour legend."
            ),
            "params": {"keep": [keep], "melt": [m.name for m in measures]},
        })

    # Two categoricals: pivot into a matrix
    if len(categoricals) >= 2 and measures:
        suggestions.append({
            "op": "pivot",
            "label": f"Pivot {categoricals[1].name} into columns",
            "reason": (
                f"With both {categoricals[0].name} and {categoricals[1].name}, a pivot creates a matrix "
                "that can be charted as grouped bars or a heatmap."
            ),
            "params": {
                "index": categoricals[0].name,
                "pivot_on": categoricals[1].name,
                "measure": measures[0].name,
                "how": "sum",
            },
        })

    return suggestions


def result_to_dict(r: TransformResult) -> dict:
    return {
        "columns": r.columns,
        "rows": r.rows,
        "description": r.description,
        "notes": r.notes,
    }
