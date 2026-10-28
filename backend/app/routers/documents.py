"""
Provisio Docs — AI-generated business documents.

Mirrors the multi-deck router (decks.py): a user owns many documents, each
scoped to the workspace owner via the shared authorize() helper. Content is a
list of prose sections; a document can be generated from the company profile,
edited, and exported to a letterheaded PDF.
"""
from typing import Any
import logging

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import select

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.core.workspace import READ, UPDATE, MANAGE, authorize as _authorize
from app.models.document import DocumentModel
from app.models.company_profile import CompanyProfileModel
from app.services.document_engine import generate_document, DOC_TYPES
from app.services.document_pdf import build_document_pdf

router = APIRouter(prefix="/documents", tags=["documents"])
log = logging.getLogger(__name__)


async def _profile_dict(session, user_id: str) -> dict:
    """The company profile as a plain dict, for document generation and the
    letterhead fallback. Empty dict if the user has no profile yet."""
    row = await session.get(CompanyProfileModel, user_id)
    if not row:
        return {}
    return {
        col.name: getattr(row, col.name)
        for col in CompanyProfileModel.__table__.columns
        if col.name not in ("user_id", "updated_at")
    }


def _letterhead_from_profile(profile: dict) -> dict:
    """The default letterhead, assembled from the company profile's brand
    fields. Used when a document carries no letterhead override of its own."""
    return {
        "logo_url": profile.get("logo_data_url") or "",
        "company_name": profile.get("company_name") or "",
        "address": profile.get("address") or "",
        "tagline": profile.get("tagline") or "",
        "primary_color": profile.get("brand_primary_color") or "",
    }


def _doc_summary(d: DocumentModel) -> dict:
    return {
        "id": d.id,
        "title": d.title,
        "doc_type": d.doc_type,
        "status": d.status,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


def _doc_full(d: DocumentModel) -> dict:
    return {
        **_doc_summary(d),
        "content": d.content or {"sections": []},
        "letterhead": d.letterhead,
    }


@router.get("")
async def list_documents(request: Request, user_id: str = Depends(get_current_user_id)):
    """List documents (metadata only) for the effective workspace owner."""
    user_id = await _authorize(request, user_id, READ)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(
                DocumentModel.id, DocumentModel.title, DocumentModel.doc_type,
                DocumentModel.status, DocumentModel.updated_at, DocumentModel.created_at,
            )
            .where(DocumentModel.user_id == user_id)
            .order_by(DocumentModel.updated_at.desc())
        )
        return [
            {
                "id": r.id, "title": r.title, "doc_type": r.doc_type, "status": r.status,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in result.all()
        ]


class CreateDocumentRequest(BaseModel):
    title: str = "Untitled Document"
    doc_type: str = "general"


@router.post("")
async def create_document(request: Request, body: CreateDocumentRequest, user_id: str = Depends(get_current_user_id)):
    user_id = await _authorize(request, user_id, MANAGE)
    doc_type = body.doc_type if body.doc_type in DOC_TYPES else "general"
    async with AsyncSessionLocal() as session:
        doc = DocumentModel(
            user_id=user_id,
            title=(body.title or "").strip() or "Untitled Document",
            doc_type=doc_type,
            content={"sections": []},
            letterhead=None,
            status="draft",
        )
        session.add(doc)
        await session.commit()
        await session.refresh(doc)
        return _doc_full(doc)


@router.get("/{doc_id}")
async def get_document(doc_id: str, request: Request, user_id: str = Depends(get_current_user_id)):
    user_id = await _authorize(request, user_id, READ)
    async with AsyncSessionLocal() as session:
        doc = await session.get(DocumentModel, doc_id)
        if not doc or doc.user_id != user_id:
            raise HTTPException(status_code=404, detail="Document not found.")
        return _doc_full(doc)


class UpdateDocumentRequest(BaseModel):
    title: str | None = None
    content: dict[str, Any] | None = None
    letterhead: dict[str, Any] | None = None
    status: str | None = None


@router.put("/{doc_id}")
async def update_document(doc_id: str, request: Request, body: UpdateDocumentRequest, user_id: str = Depends(get_current_user_id)):
    user_id = await _authorize(request, user_id, UPDATE)
    async with AsyncSessionLocal() as session:
        doc = await session.get(DocumentModel, doc_id)
        if not doc or doc.user_id != user_id:
            raise HTTPException(status_code=404, detail="Document not found.")
        if body.title is not None:
            name = body.title.strip()
            if not name:
                raise HTTPException(status_code=400, detail="Document title can't be empty.")
            doc.title = name
        if body.content is not None:
            doc.content = body.content
        # letterhead is nullable on purpose: null means "use the company
        # profile". The field being present in the body (even as null) is a
        # deliberate choice to reset to the profile default.
        if "letterhead" in body.model_fields_set:
            doc.letterhead = body.letterhead
        if body.status is not None:
            if body.status not in ("draft", "generated", "final"):
                raise HTTPException(status_code=400, detail="Unknown document status.")
            doc.status = body.status
        await session.commit()
        await session.refresh(doc)
        return _doc_full(doc)


@router.delete("/{doc_id}")
async def delete_document(doc_id: str, request: Request, user_id: str = Depends(get_current_user_id)):
    user_id = await _authorize(request, user_id, MANAGE)
    async with AsyncSessionLocal() as session:
        doc = await session.get(DocumentModel, doc_id)
        if not doc or doc.user_id != user_id:
            raise HTTPException(status_code=404, detail="Document not found.")
        await session.delete(doc)
        await session.commit()
    return {"status": "deleted"}


class GenerateDocumentRequest(BaseModel):
    doc_type: str | None = None
    brief: str | None = None


@router.post("/{doc_id}/generate")
async def generate_document_content(doc_id: str, request: Request, body: GenerateDocumentRequest, user_id: str = Depends(get_current_user_id)):
    """Generate the document's content from the company profile. Rewrites the
    content and sets status to 'generated'; also adopts the doc_type when one is
    supplied, and fills a blank title from the generated title."""
    user_id = await _authorize(request, user_id, UPDATE)
    async with AsyncSessionLocal() as session:
        doc = await session.get(DocumentModel, doc_id)
        if not doc or doc.user_id != user_id:
            raise HTTPException(status_code=404, detail="Document not found.")

        doc_type = body.doc_type if (body.doc_type in DOC_TYPES) else doc.doc_type
        profile = await _profile_dict(session, user_id)

        try:
            result = generate_document(profile, doc_type, body.brief)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Couldn't generate this document: {e}")

        doc.doc_type = doc_type
        doc.content = {"sections": result.get("sections", [])}
        doc.status = "generated"
        generated_title = (result.get("title") or "").strip()
        # Only adopt the AI title when the user hasn't named the doc themselves.
        if generated_title and (not doc.title or doc.title == "Untitled Document"):
            doc.title = generated_title
        await session.commit()
        await session.refresh(doc)
        return _doc_full(doc)


@router.post("/{doc_id}/export")
async def export_document(doc_id: str, request: Request, user_id: str = Depends(get_current_user_id)):
    """Render the document to a letterheaded PDF and return it as a download."""
    user_id = await _authorize(request, user_id, READ)
    async with AsyncSessionLocal() as session:
        doc = await session.get(DocumentModel, doc_id)
        if not doc or doc.user_id != user_id:
            raise HTTPException(status_code=404, detail="Document not found.")

        # Resolve the letterhead: the document's own override when it has one,
        # otherwise the company profile's brand fields.
        if doc.letterhead:
            letterhead = doc.letterhead
        else:
            letterhead = _letterhead_from_profile(await _profile_dict(session, user_id))

        sections = (doc.content or {}).get("sections", []) if isinstance(doc.content, dict) else []
        content = build_document_pdf(doc.title, sections, letterhead)

        safe_name = "".join(c for c in doc.title if c.isalnum() or c in " -_").strip() or "document"
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
        )
