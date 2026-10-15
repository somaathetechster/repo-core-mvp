"""
Workspace resolution shared across routers.

A request may be acting inside another user's workspace, signalled by the
``X-Workspace-Id`` header (set by the frontend workspace switcher). When it is,
the *effective* owner of the data is that workspace's owner, and what the
caller may do is governed by the role on their accepted CollaboratorModel
row — not by their own account. Acting in your own workspace (no header, or a
header naming yourself) is always full "admin" access.

This used to live inside app/routers/decks.py. It was lifted here so other
routers (company_profile, repos, ...) can scope their queries to the workspace
owner the same way, without importing from a sibling router (which would form
an import cycle, since decks.py already imports CompanyProfileIn).

Capability ladder (weakest to strongest):
    viewer / commenter  read only (comments are handled separately)
    editor              read + update content
    manager             read + create + update + delete
    admin               everything
"""
from fastapi import HTTPException, Request
from sqlalchemy import text

from app.core.db import AsyncSessionLocal

_ROLE_RANK = {"viewer": 0, "commenter": 0, "editor": 1, "manager": 2, "admin": 3}

# What each action requires, expressed as the weakest role that may do it.
READ = "viewer"
UPDATE = "editor"
MANAGE = "manager"


def check_permission(role: str, required: str) -> bool:
    """True if ``role`` is strong enough for an action needing ``required``."""
    return _ROLE_RANK.get(role, -1) >= _ROLE_RANK.get(required, 99)


async def get_effective_user(request: Request, current_user: str) -> tuple[str, str]:
    """Resolve whose workspace this request acts in, and with what role.

    Returns (effective_owner_id, role). Acting in your own account (no header,
    or a header naming yourself) is full "admin". Acting in someone else's
    workspace requires an accepted collaborator row, otherwise it's a 403.
    """
    workspace_id = request.headers.get("X-Workspace-Id")
    if not workspace_id or workspace_id == current_user:
        return current_user, "admin"

    # A plain parameterised text() query rather than the ORM, to keep this
    # lookup off SQLAlchemy's compiled-construct path. Parameters are bound
    # (:owner_id / :user_id), so this is not string interpolation.
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                "SELECT id, owner_id, invitee_email, invitee_user_id, role, status "
                "FROM collaborators "
                "WHERE owner_id = :owner_id "
                "AND invitee_user_id = :user_id "
                "AND status = 'accepted' "
                "LIMIT 1"
            ),
            {"owner_id": workspace_id, "user_id": current_user},
        )
        row = result.fetchone()

    if not row:
        raise HTTPException(status_code=403, detail="You don't have access to this workspace.")
    return workspace_id, row.role


async def authorize(request: Request, current_user: str, required: str) -> str:
    """get_effective_user + check_permission in one step. Returns the effective
    owner id whose data the handler should operate on."""
    owner_id, role = await get_effective_user(request, current_user)
    if not check_permission(role, required):
        raise HTTPException(
            status_code=403,
            detail="Your role in this workspace doesn't allow that action.",
        )
    return owner_id
