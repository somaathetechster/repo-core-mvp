"""
CRUD for Data Studio records: small tables of data (competitive analysis,
profit margins, market sizing, or a free-form custom table) that can be
rendered as a chart and, once the founder is happy with it, inserted into
their deck as a chart slide.
"""
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.models.data_record import DataRecordModel

router = APIRouter(prefix="/data-records", tags=["data-records"])

RECORD_TYPES = [
    {
        "key": "competitive_analysis",
        "label": "Competitive analysis",
        "default_columns": ["Competitor", "Price", "Key strength", "Key weakness"],
    },
    {
        "key": "profit_margin",
        "label": "Profit margins",
        "default_columns": ["Item", "Revenue", "Cost", "Margin %"],
    },
    {
        "key": "market_sizing",
        "label": "Market sizing",
        "default_columns": ["Segment", "Value"],
    },
    {
        "key": "custom",
        "label": "Custom table",
        "default_columns": ["Label", "Value"],
    },
]


@router.get("/types")
async def list_record_types():
    return RECORD_TYPES


class DataRecordIn(BaseModel):
    record_type: str
    title: str = ""
    columns: list[str] = []
    rows: list[list[str]] = []
    chart_type: str = "table"


@router.get("")
async def list_records(user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(DataRecordModel).where(DataRecordModel.user_id == user_id).order_by(DataRecordModel.created_at.desc())
        )
        records = result.scalars().all()
        return [
            {
                "id": r.id,
                "record_type": r.record_type,
                "title": r.title,
                "columns": r.columns,
                "rows": r.rows,
                "chart_type": r.chart_type,
            }
            for r in records
        ]


@router.post("")
async def create_record(body: DataRecordIn, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        record = DataRecordModel(
            user_id=user_id,
            record_type=body.record_type,
            title=body.title,
            columns=body.columns,
            rows=body.rows,
            chart_type=body.chart_type,
        )
        session.add(record)
        await session.commit()
        await session.refresh(record)
        return {"id": record.id}


@router.put("/{record_id}")
async def update_record(record_id: str, body: DataRecordIn, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        record = await session.get(DataRecordModel, record_id)
        if not record or record.user_id != user_id:
            raise HTTPException(status_code=404, detail="Record not found.")
        record.record_type = body.record_type
        record.title = body.title
        record.columns = body.columns
        record.rows = body.rows
        record.chart_type = body.chart_type
        await session.commit()
    return {"status": "saved"}


@router.delete("/{record_id}")
async def delete_record(record_id: str, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        record = await session.get(DataRecordModel, record_id)
        if not record or record.user_id != user_id:
            raise HTTPException(status_code=404, detail="Record not found.")
        await session.delete(record)
        await session.commit()
    return {"status": "deleted"}
