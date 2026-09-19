"""
Import an existing pitch deck and propose company-profile field values.
"""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.deps import get_current_user_id
from app.services.deck_import import extract_deck, map_to_profile, import_to_dict

router = APIRouter(prefix="/company-profile", tags=["company-profile"])

MAX_DECK_BYTES = 25 * 1024 * 1024


@router.post("/import-deck")
async def import_deck(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """
    Reads a PDF or PPTX pitch deck and returns suggested profile field
    values, each tagged with the slides it came from and a confidence level.

    Nothing is saved here. The founder reviews and accepts field by field,
    because silently overwriting a profile with extracted guesses would be
    worse than asking them to type it.
    """
    contents = await file.read()
    if len(contents) > MAX_DECK_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"That deck is {len(contents) / 1_000_000:.1f}MB. The limit is 25MB.",
        )

    filename = file.filename or "deck"
    try:
        slides = extract_deck(contents, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read that deck: {e}")

    if not slides:
        raise HTTPException(
            status_code=400,
            detail=(
                "No readable text was found. If the deck is a PDF export of image slides, "
                "the text isn't selectable and can't be extracted."
            ),
        )

    try:
        result = map_to_profile(slides)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return import_to_dict(result)
