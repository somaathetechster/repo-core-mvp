"""
Chart recommendation: picks visualizations that are correct for the data's
actual shape, and explains why.

The rules here come from standard data-visualization practice, applied to
the semantic roles that schema_inference produced. The point is that the
right chart is a function of the data's structure, not of what the user
happens to click:

  temporal dimension + measure(s)        -> line (trend over time)
  categorical (low cardinality) + measure -> bar
  categorical parts summing to a whole    -> pie/donut, but only if it
                                             genuinely is a part-to-whole
  two measures                            -> scatter (correlation)
  temporal + categorical + measure        -> grouped/stacked bar or
                                             multi-series line
  categorical x categorical + measure     -> heatmap
  single measure distribution             -> histogram
  geographic dimension + measure          -> map

Each recommendation carries a score and a plain-language reason, and
unsuitable charts are explicitly marked with why they'd mislead. A pie
chart of 40 categories, or a line chart over a non-temporal axis, are
common and genuinely wrong, so we refuse to silently offer them.
"""
from dataclasses import dataclass, field

from app.services.schema_inference import (
    TableProfile,
    ColumnProfile,
    ROLE_TEMPORAL,
    ROLE_CATEGORICAL,
    ROLE_MEASURE,
    TYPE_PERCENTAGE,
)

# Country/region names and ISO codes we can map. Kept deliberately small
# and explicit rather than guessing, a wrong map is worse than no map.
GEO_NAME_HINTS = {"country", "region", "state", "province", "city", "location", "market", "territory"}

ISO_COUNTRY_CODES = {
    "NG", "KE", "GH", "ZA", "EG", "US", "GB", "UK", "CA", "FR", "DE", "IN",
    "CN", "JP", "BR", "AU", "MX", "ES", "IT", "NL", "SE", "AE", "SA", "TZ",
    "UG", "RW", "ET", "CI", "SN", "CM", "ZM", "ZW", "MA", "DZ", "TN",
}


@dataclass
class ChartRecommendation:
    chart_type: str
    title: str
    reason: str
    score: float
    encoding: dict  # which columns map to which visual channel
    warnings: list[str] = field(default_factory=list)


@dataclass
class ChartRejection:
    chart_type: str
    reason: str


@dataclass
class ChartAdvice:
    recommendations: list[ChartRecommendation]
    rejections: list[ChartRejection]


def _is_geographic(col: ColumnProfile) -> bool:
    name_hint = any(h in col.name.lower() for h in GEO_NAME_HINTS)
    if not name_hint:
        return False
    values = [str(v).strip().upper() for v in col.parsed_values if v]
    if not values:
        return False
    # Confirm the values actually look like places, not just that the
    # column is named "region" while holding arbitrary labels.
    code_hits = sum(1 for v in values if v in ISO_COUNTRY_CODES)
    return code_hits / len(values) > 0.5 or name_hint


def _sums_to_whole(measure: ColumnProfile, tolerance: float = 0.02) -> bool:
    """
    True when the measure's values plausibly form a part-to-whole breakdown,
    which is the only case a pie chart is honest. Detected either by the
    values summing to ~100 (percentages) or by the column being a share.
    """
    values = [v for v in measure.parsed_values if v is not None]
    if not values or any(v < 0 for v in values):
        return False
    total = sum(values)
    if measure.is_percentage or "share" in measure.name.lower() or "%" in measure.name:
        return abs(total - 100.0) / 100.0 < 0.1 or abs(total - 1.0) < 0.1
    return False


def recommend_charts(profile: TableProfile) -> ChartAdvice:
    temporal = profile.by_role(ROLE_TEMPORAL)
    categorical = profile.by_role(ROLE_CATEGORICAL)
    measures = profile.by_role(ROLE_MEASURE)

    recs: list[ChartRecommendation] = []
    rejections: list[ChartRejection] = []

    # ---- No measures at all -------------------------------------------
    if not measures:
        if categorical:
            recs.append(ChartRecommendation(
                chart_type="bar",
                title=f"Count by {categorical[0].name}",
                reason="No numeric column was found, so the only meaningful chart is a count of rows per category.",
                score=0.5,
                encoding={"dimension": categorical[0].name, "measure": "__count__", "aggregate": "count"},
            ))
        rejections.append(ChartRejection(
            chart_type="line",
            reason="No numeric measure to plot. A line chart needs a quantity that changes.",
        ))
        recs.append(_table_fallback(profile))
        return ChartAdvice(recommendations=recs, rejections=rejections)

    # ---- Temporal: trend over time ------------------------------------
    if temporal:
        time_col = temporal[0]
        # Multi-series line when there are several comparable measures
        comparable = [m for m in measures if not m.is_percentage]
        if len(comparable) >= 2 and _similar_magnitude(comparable):
            recs.append(ChartRecommendation(
                chart_type="line",
                title=f"{' and '.join(m.name for m in comparable[:3])} over {time_col.name}",
                reason=(
                    f"{time_col.name} is a time dimension ({time_col.date_granularity}ly), so a line chart "
                    "shows the trend. These measures are on a similar scale, so they can share one axis."
                ),
                score=0.95,
                encoding={
                    "x": time_col.name,
                    "y": [m.name for m in comparable[:3]],
                    "type": "multi-series",
                },
            ))
        for m in measures[:4]:
            warnings = []
            if profile.row_count < 3:
                warnings.append("Only a few time points; a trend line may over-suggest a pattern.")
            recs.append(ChartRecommendation(
                chart_type="line",
                title=f"{m.name} over {time_col.name}",
                reason=(
                    f"{time_col.name} is a time dimension and {m.name} is a measure. A line chart is the "
                    "standard way to show how a quantity moves over time."
                ),
                score=0.9 if m is measures[0] else 0.75,
                encoding={"x": time_col.name, "y": [m.name], "type": "single-series"},
                warnings=warnings,
            ))
        rejections.append(ChartRejection(
            chart_type="pie",
            reason=(
                "This data has a time dimension. A pie chart would collapse the time axis and hide the trend, "
                "which is the most important thing here."
            ),
        ))

    # ---- Categorical: comparison across groups ------------------------
    for cat in categorical[:2]:
        cardinality = cat.unique_count
        for m in measures[:3]:
            if cardinality > 25:
                rejections.append(ChartRejection(
                    chart_type="bar",
                    reason=(
                        f"{cat.name} has {cardinality} distinct values. A bar chart with that many categories "
                        "is unreadable; showing the top 10 or grouping the tail would work better."
                    ),
                ))
                recs.append(ChartRecommendation(
                    chart_type="bar",
                    title=f"Top 10 {cat.name} by {m.name}",
                    reason=(
                        f"{cat.name} has {cardinality} distinct values, too many to show at once, so this "
                        "ranks the top 10 and groups the rest."
                    ),
                    score=0.8,
                    encoding={"dimension": cat.name, "measure": m.name, "limit": 10, "sort": "desc"},
                    warnings=[f"{cardinality - 10} smaller categories are grouped into 'Other'."],
                ))
            else:
                recs.append(ChartRecommendation(
                    chart_type="bar",
                    title=f"{m.name} by {cat.name}",
                    reason=(
                        f"{cat.name} is a category with {cardinality} values and {m.name} is a measure. "
                        "A bar chart compares quantities across groups, which is what this data is for."
                    ),
                    score=0.9 if not temporal else 0.7,
                    encoding={"dimension": cat.name, "measure": m.name, "sort": "desc"},
                ))

            # Pie only when it's genuinely part-to-whole and readable
            if _sums_to_whole(m) and cardinality <= 8:
                recs.append(ChartRecommendation(
                    chart_type="pie",
                    title=f"Share of {m.name} by {cat.name}",
                    reason=(
                        f"{m.name} sums to a whole across {cardinality} categories, which is the one case "
                        "a pie chart is honest: showing parts of a single total."
                    ),
                    score=0.7,
                    encoding={"dimension": cat.name, "measure": m.name},
                ))
            elif cardinality > 8:
                rejections.append(ChartRejection(
                    chart_type="pie",
                    reason=(
                        f"{cat.name} has {cardinality} categories. Pie charts become unreadable past about 6-8 "
                        "slices; a ranked bar chart communicates the same thing more clearly."
                    ),
                ))
            elif not _sums_to_whole(m):
                rejections.append(ChartRejection(
                    chart_type="pie",
                    reason=(
                        f"{m.name} doesn't represent parts of a whole, so a pie chart would imply a "
                        "relationship between slices that doesn't exist."
                    ),
                ))

        # Geographic
        if _is_geographic(cat) and measures:
            recs.append(ChartRecommendation(
                chart_type="map",
                title=f"{measures[0].name} by {cat.name}",
                reason=(
                    f"{cat.name} contains geographic values, so a map shows the spatial distribution "
                    "in a way a bar chart cannot."
                ),
                score=0.85,
                encoding={"geo_dimension": cat.name, "measure": measures[0].name},
                warnings=(
                    ["Only one location present, so a map adds little over a single number."]
                    if cat.unique_count < 2 else []
                ),
            ))

    # ---- Two measures: correlation ------------------------------------
    if len(measures) >= 2 and profile.row_count >= 5:
        x, y = measures[0], measures[1]
        recs.append(ChartRecommendation(
            chart_type="scatter",
            title=f"{y.name} against {x.name}",
            reason=(
                f"Both {x.name} and {y.name} are measures across {profile.row_count} rows. A scatter plot "
                "reveals whether they move together, which no single-measure chart can show."
            ),
            score=0.65,
            encoding={"x": x.name, "y": y.name},
        ))

    # ---- Distribution --------------------------------------------------
    if measures and profile.row_count >= 12 and not temporal:
        m = measures[0]
        recs.append(ChartRecommendation(
            chart_type="histogram",
            title=f"Distribution of {m.name}",
            reason=(
                f"With {profile.row_count} rows and no time or grouping dimension in play, a histogram "
                f"shows how {m.name} is distributed rather than just its total."
            ),
            score=0.6,
            encoding={"measure": m.name, "bins": 12},
        ))

    # ---- Two categoricals plus a measure: heatmap ----------------------
    if len(categorical) >= 2 and measures:
        c1, c2 = categorical[0], categorical[1]
        if c1.unique_count <= 20 and c2.unique_count <= 20:
            recs.append(ChartRecommendation(
                chart_type="heatmap",
                title=f"{measures[0].name} by {c1.name} and {c2.name}",
                reason=(
                    f"Two category dimensions ({c1.name}, {c2.name}) with a measure form a matrix. "
                    "A heatmap shows the whole grid at once, where a bar chart would need many panels."
                ),
                score=0.75,
                encoding={"row": c1.name, "column": c2.name, "measure": measures[0].name},
            ))

    # ---- Key-value shape: a table or stat cards is genuinely best ------
    if len(profile.columns) == 2 and categorical and len(measures) == 1:
        if profile.row_count <= 12:
            recs.append(ChartRecommendation(
                chart_type="stat_cards",
                title=f"{profile.title} at a glance",
                reason=(
                    "This is a short list of named values, which reads better as highlighted figures "
                    "than as a chart with a near-empty axis."
                ),
                score=0.85 if profile.row_count <= 6 else 0.6,
                encoding={"label": categorical[0].name, "value": measures[0].name},
            ))

    recs.append(_table_fallback(profile))
    recs.sort(key=lambda r: -r.score)

    # Deduplicate rejections by (type, reason)
    seen = set()
    unique_rejections = []
    for r in rejections:
        key = (r.chart_type, r.reason)
        if key not in seen:
            seen.add(key)
            unique_rejections.append(r)

    return ChartAdvice(recommendations=recs, rejections=unique_rejections)


def _similar_magnitude(measures: list[ColumnProfile]) -> bool:
    """
    Measures can share a y-axis only if they're on comparable scales.
    Plotting revenue in the tens of thousands beside a count in the tens
    makes the smaller series a flat line at zero, which is a real and
    common charting error.
    """
    maxes = [m.max_value for m in measures if m.max_value is not None and m.max_value != 0]
    if len(maxes) < 2:
        return False
    return max(maxes) / min(maxes) <= 25


def _table_fallback(profile: TableProfile) -> ChartRecommendation:
    return ChartRecommendation(
        chart_type="table",
        title=profile.title,
        reason="A formatted table shows every value precisely, which is the right choice when exact figures matter more than shape.",
        score=0.4,
        encoding={"columns": [c.name for c in profile.columns]},
    )


def advice_to_dict(advice: ChartAdvice) -> dict:
    return {
        "recommendations": [
            {
                "chart_type": r.chart_type,
                "title": r.title,
                "reason": r.reason,
                "score": round(r.score, 2),
                "encoding": r.encoding,
                "warnings": r.warnings,
            }
            for r in advice.recommendations
        ],
        "rejections": [
            {"chart_type": r.chart_type, "reason": r.reason} for r in advice.rejections
        ],
    }
