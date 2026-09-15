"""
A single data record in the Data Studio: a small table of rows (e.g. a
competitive analysis, a profit-margin breakdown, a market-sizing table)
plus which chart type to render it as. Unlike company_profiles or
saved_decks, a user can have many of these, so this uses a generated id
as primary key with user_id as a plain indexed column, not the primary key.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _new_id() -> str:
    return uuid.uuid4().hex


class DataRecordModel(Base):
    __tablename__ = "data_records"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column(String, index=True)
    record_type: Mapped[str] = mapped_column(String)  # "competitive_analysis" | "profit_margin" | "market_sizing" | "custom"
    title: Mapped[str] = mapped_column(String, default="")
    columns: Mapped[list] = mapped_column(JSON, default=list)  # list[str] column headers
    rows: Mapped[list] = mapped_column(JSON, default=list)  # list[list[str]] row values, aligned to columns
    chart_type: Mapped[str] = mapped_column(String, default="table")  # "bar" | "line" | "pie" | "table"
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
