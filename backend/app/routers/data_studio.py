"""
Data Studio API.

The flow this supports:
  1. POST /data-studio/ingest    upload a file or paste text -> detected tables
  2. POST /data-studio/profile   a chosen table -> column types, roles, issues,
                                 recommended charts, suggested transforms
  3. POST /data-studio/transform apply a reshape -> new table (re-profiled)

Profiling and recommendation run server-side because the type inference is
substantial and needs to behave identically regardless of browser.
"""
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.deps import get_current_user_id
from app.services.data_ingestion import ingest, raw_table_to_dict
from app.services.schema_inference import profile_table, table_profile_to_dict
from app.services.chart_recommendation import recommend_charts, advice_to_dict
from app.services import data_transform as dt

router = APIRouter(prefix="/data-studio", tags=["data-studio"])

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15MB


class IngestTextRequest(BaseModel):
    text: str


@router.post("/ingest")
async def ingest_text(body: IngestTextRequest, user_id: str = Depends(get_current_user_id)):
    """Ingest pasted text (CSV/TSV/JSON, format auto-detected)."""
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Nothing to import.")
    try:
        tables = ingest(text=body.text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not tables:
        raise HTTPException(
            status_code=400,
            detail="No table could be found in that input. Check that it has a header row and at least one data row.",
        )
    return {"tables": [raw_table_to_dict(t) for t in tables]}


@router.post("/ingest-file")
async def ingest_file(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """Ingest an uploaded file: CSV, TSV, JSON, Excel, or PDF."""
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File is {len(contents) / 1_000_000:.1f}MB. The limit is 15MB.",
        )
    try:
        tables = ingest(file_bytes=contents, filename=file.filename or "upload")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read that file: {e}")

    if not tables:
        raise HTTPException(
            status_code=400,
            detail=(
                "No tables were found in that file. For PDFs this usually means the tables are images "
                "rather than selectable text."
            ),
        )
    return {"tables": [raw_table_to_dict(t) for t in tables], "filename": file.filename}


class ProfileRequest(BaseModel):
    title: str = "Imported data"
    columns: list[str]
    rows: list[list[Any]]


@router.post("/profile")
async def profile(body: ProfileRequest, user_id: str = Depends(get_current_user_id)):
    """
    Infers column types and semantic roles, flags data-quality issues,
    recommends appropriate charts (with reasons), explicitly rejects
    inappropriate ones (with reasons), and suggests useful transforms.
    """
    string_rows = [[("" if c is None else str(c)) for c in row] for row in body.rows]
    table_profile = profile_table(body.title, body.columns, string_rows)
    advice = recommend_charts(table_profile)
    transforms = dt.suggest_transforms(table_profile)

    return {
        "profile": table_profile_to_dict(table_profile),
        "charts": advice_to_dict(advice),
        "suggested_transforms": transforms,
    }


class TransformRequest(BaseModel):
    op: str
    columns: list[str]
    rows: list[list[Any]]
    params: dict[str, Any] = {}
    title: str = "Transformed data"


@router.post("/transform")
async def transform(body: TransformRequest, user_id: str = Depends(get_current_user_id)):
    """
    Applies one reshape operation and returns the new table together with a
    fresh profile and chart advice, since reshaping changes what's chartable.
    """
    ops = {
        "aggregate": lambda: dt.aggregate(
            body.columns, body.rows,
            group_by=body.params.get("group_by", []),
            measure=body.params.get("measure"),
            how=body.params.get("how", "sum"),
        ),
        "top_n": lambda: dt.top_n(
            body.columns, body.rows,
            measure=body.params["measure"],
            n=int(body.params.get("n", 10)),
            group_remainder=bool(body.params.get("group_remainder", True)),
            label_column=body.params.get("label_column"),
        ),
        "pivot": lambda: dt.pivot(
            body.columns, body.rows,
            index=body.params["index"],
            pivot_on=body.params["pivot_on"],
            measure=body.params["measure"],
            how=body.params.get("how", "sum"),
        ),
        "unpivot": lambda: dt.unpivot(
            body.columns, body.rows,
            keep=body.params.get("keep", []),
            melt=body.params.get("melt", []),
            variable_name=body.params.get("variable_name", "Series"),
            value_name=body.params.get("value_name", "Value"),
        ),
        "filter": lambda: dt.filter_rows(
            body.columns, body.rows,
            column=body.params["column"],
            operator=body.params.get("operator", "="),
            value=str(body.params.get("value", "")),
        ),
        "sort": lambda: dt.sort_rows(
            body.columns, body.rows,
            column=body.params["column"],
            descending=bool(body.params.get("descending", True)),
        ),
        "derive_share": lambda: dt.derive_share(
            body.columns, body.rows, measure=body.params["measure"]
        ),
        "derive_running_total": lambda: dt.derive_running_total(
            body.columns, body.rows, measure=body.params["measure"]
        ),
    }

    if body.op not in ops:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown operation '{body.op}'. Available: {', '.join(ops)}",
        )

    try:
        result = ops[body.op]()
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Missing required parameter: {e}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    string_rows = [[("" if c is None else str(c)) for c in row] for row in result.rows]
    new_profile = profile_table(body.title, result.columns, string_rows)
    advice = recommend_charts(new_profile)

    return {
        "result": dt.result_to_dict(result),
        "profile": table_profile_to_dict(new_profile),
        "charts": advice_to_dict(advice),
        "suggested_transforms": dt.suggest_transforms(new_profile),
    }
