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
    PAIRING_FAMILIES,
)
from app.services.font_embed import embed_fonts_in_pptx
from app.routers.billing import require_export_entitlement, record_export

router = APIRouter(prefix="/decks", tags=["decks"])


def _inline_image_refs(value, image_map: dict[str, str]):
    """Expand content-addressed image references before rendering an export.

    The editor stores large image data URLs once in ``theme.images`` and
    replaces slide image fields with ``ref:<hash>``.  That is ideal for
    persistence, but the exporters intentionally only understand data URLs.
    Keep this conversion at the export boundary so the compact stored format
    and the renderer's simple contract can coexist.
    """
    if isinstance(value, str) and value.startswith("ref:"):
        return image_map.get(value[4:], value)
    if isinstance(value, list):
        return [_inline_image_refs(item, image_map) for item in value]
    if isinstance(value, dict):
        return {key: _inline_image_refs(item, image_map) for key, item in value.items()}
    return value


class ExportRequest(BaseModel):
    format: str  # "pptx" | "pdf"
    chart_images: dict[str, str] = {}  # slide_id -> PNG data URL, captured client-side
    asset_images: dict[str, str] = {}  # element asset key -> PNG data URL
    slide_images: dict[str, str] = {}  # element slide id -> browser-rendered PNG


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

        # The gate. Raises 402 with the plan list if they can't export yet.
        entitlement = await require_export_entitlement(session, user_id, deck_id)

        safe_name = "".join(c for c in deck.name if c.isalnum() or c in " -_").strip() or "deck"

        # Image data is deduplicated in the editor before being persisted.
        # Resolve those references for both the legacy and element exporters;
        # old decks with inline data URLs pass through unchanged.
        stored_theme = deck.theme or {}
        image_map = stored_theme.get("images") or {}
        slides = _inline_image_refs(deck.slides or [], image_map)
        theme = _inline_image_refs(stored_theme, image_map)

        # Decks that have been through the element editor export from their
        # element frames, so hand-positioned layouts survive. Decks not yet
        # opened since the migration still export via the legacy path.
        use_elements = deck_has_elements(slides)

        if body.format == "pptx":
            content = (
                build_pptx_from_elements(deck.name, slides, theme, body.chart_images, body.asset_images, body.slide_images)
                if use_elements
                else build_pptx(deck.name, slides, theme, body.chart_images)
            )
            # Embed the deck's typefaces so it looks the same on a machine
            # that has never had them installed. A licence-restricted or
            # unreachable font is skipped rather than failing the export.
            pairing = (theme or {}).get("font_pairing") or "fraunces-inter"
            families = sorted(set(
                PAIRING_FAMILIES.get(pairing, PAIRING_FAMILIES["fraunces-inter"]).values()
            ))
            try:
                content, _unembeddable = embed_fonts_in_pptx(content, families)
            except Exception:
                pass  # Export without embedded fonts beats no export.
            media_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            filename = f"{safe_name}.pptx"
        else:
            content = (
                build_pdf_from_elements(deck.name, slides, theme, body.chart_images, body.asset_images, body.slide_images)
                if use_elements
                else build_pdf(deck.name, slides, theme, body.chart_images)
            )
            media_type = "application/pdf"
            filename = f"{safe_name}.pdf"

        # Recorded only after the file exists, so a failed export never
        # burns a one-time purchase.
        await record_export(session, user_id, deck_id, entitlement)

        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
