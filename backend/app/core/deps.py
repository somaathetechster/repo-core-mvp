"""
Placeholder for real user auth. Replace with your actual session/JWT check.
Keeping this as a single dependency means swapping auth systems later only
touches this file, not every router.
"""
from fastapi import Header, HTTPException


async def get_current_user_id(x_user_id: str = Header(...)) -> str:
    # TODO: replace with real session/JWT validation.
    # For now this trusts an X-User-Id header, which is ONLY acceptable
    # for local development — never ship this to production as-is.
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return x_user_id
