from dataclasses import asdict
from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.deps import get_current_user_id
from app.core.workspace import READ, authorize
from app.services import github_store, github_extract
from app.services.deep_repo_analysis import analyze_repo_deeply
from app.services.technical_diligence import (
    generate_technical_diligence,
    generate_technology_slide,
    diligence_to_dict,
)

router = APIRouter(prefix="/repos", tags=["repos"])


@router.get("")
async def list_repos(request: Request, user_id: str = Depends(get_current_user_id)):
    # Inside another user's workspace, list the workspace owner's connected
    # repos (their GitHub installation), not the caller's own.
    owner_id = await authorize(request, user_id, READ)
    connection = await github_store.get_user_connection(owner_id)
    if not connection:
        raise HTTPException(status_code=400, detail="GitHub not connected. Call /auth/github/install first.")
    return await github_extract.list_installation_repos(connection.access_token, connection.installation_id)


@router.post("/{owner}/{repo}/analyze")
async def analyze_repo(owner: str, repo: str, request: Request, user_id: str = Depends(get_current_user_id)):
    """
    Deep analysis: reads actual source files from the repository, infers
    architecture and integrations, and produces a real technical due
    diligence assessment plus the deck's Technology slide.

    This is deliberately slower than a metadata lookup (it fetches and
    reads up to 40 real source files, then runs a substantial model call),
    because the depth is the product.
    """
    owner_id = await authorize(request, user_id, READ)
    connection = await github_store.get_user_connection(owner_id)
    if not connection:
        raise HTTPException(status_code=400, detail="GitHub not connected.")

    full_name = f"{owner}/{repo}"

    try:
        analysis = await analyze_repo_deeply(connection.access_token, full_name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    try:
        diligence = generate_technical_diligence(analysis)
        slide_content = generate_technology_slide(analysis, diligence)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"Analysis model error: {e}")

    # The full source excerpts are large and only needed server-side during
    # generation, so they're stripped from the response. Everything the
    # frontend shows as "evidence" is kept.
    analysis_dict = asdict(analysis)
    analysis_dict.pop("source_excerpts", None)

    return {
        "summary": analysis_dict,
        "diligence": diligence_to_dict(diligence),
        "technology_slide_content": slide_content,
    }
