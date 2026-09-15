from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import get_current_user_id
from app.services import github_store, github_extract
from app.services.narrative import build_technology_slide_content

router = APIRouter(prefix="/repos", tags=["repos"])


@router.get("")
async def list_repos(user_id: str = Depends(get_current_user_id)):
    connection = await github_store.get_user_connection(user_id)
    if not connection:
        raise HTTPException(status_code=400, detail="GitHub not connected. Call /auth/github/install first.")
    return await github_extract.list_installation_repos(connection.access_token, connection.installation_id)


@router.post("/{owner}/{repo}/analyze")
async def analyze_repo(owner: str, repo: str, user_id: str = Depends(get_current_user_id)):
    connection = await github_store.get_user_connection(user_id)
    if not connection:
        raise HTTPException(status_code=400, detail="GitHub not connected.")

    full_name = f"{owner}/{repo}"
    try:
        summary = await github_extract.extract_repo_summary(connection.access_token, full_name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    slide_content = build_technology_slide_content(summary)

    return {
        "summary": summary.model_dump(),
        "technology_slide_content": slide_content,
    }
