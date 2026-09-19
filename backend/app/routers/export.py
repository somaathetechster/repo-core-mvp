"""
Export a deck to a downloadable PPTX or PDF file.

POST rather than GET, because chart images (captured client-side via
html2canvas, see chartCapture.tsx) need to be sent in the request body,
they're too large and numerous to fit in a query string.
"""
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.models.deck import DeckModel
from app.services.exporters import build_pptx, build_pdf
from app.services.element_export import (
    build_pptx_from_elements, build_pdf_from_elements, deck_has_elements,
)

router = APIRouter(prefix="/decks", tags=["decks"])


class ExportRequest(BaseModel):
    format: str  # "pptx" | "pdf"
    chart_images: dict[str, str] = {}  # slide_id -> PNG data URL, captured client-side


@router.post("/{deck_id}/export")
async def export_deck(
    deck_id: str,
    body: ExportRequest,
    user_id: str = Depends(get_current_user_id),
):
    if body.format not in ("pptx", "pdf"):
        raise HTTPException(status_code=400, detail="format must be 'pptx' or 'pdf'.")

    async with AsyncSessionLocal() as session:
        deck = await session.get(DeckModel, deck_id)
        if not deck or deck.user_id != user_id:
            raise HTTPException(status_code=404, detail="Deck not found.")

        safe_name = "".join(c for c in deck.name if c.isalnum() or c in " -_").strip() or "deck"

        # Decks that have been through the element editor export from their
        # element frames, so hand-positioned layouts survive. Decks not yet
        # opened since the migration still export via the legacy path.
        use_elements = deck_has_elements(deck.slides)

        if body.format == "pptx":
            content = (
                build_pptx_from_elements(deck.name, deck.slides, deck.theme, body.chart_images)
                if use_elements
                else build_pptx(deck.name, deck.slides, deck.theme, body.chart_images)
            )
            media_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            filename = f"{safe_name}.pptx"
        else:
            content = (
                build_pdf_from_elements(deck.name, deck.slides, deck.theme, body.chart_images)
                if use_elements
                else build_pdf(deck.name, deck.slides, deck.theme, body.chart_images)
            )
            media_type = "application/pdf"
            filename = f"{safe_name}.pdf"

        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
