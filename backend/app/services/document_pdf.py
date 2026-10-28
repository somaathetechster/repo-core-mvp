"""
Render a Provisio Doc into a downloadable PDF, with the resolved letterhead
drawn on the header of every page.

This reuses reportlab (already a dependency, see exporters.py) rather than the
deck exporters, because a document is a flowing text layout — a letterhead band,
then headings and prose that paginate automatically — not fixed slide canvases.
The letterhead is painted in an onPage callback so it repeats on every page,
including ones created by the automatic page breaks between long sections.
"""
import base64
import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, black, Color
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.utils import ImageReader


# Letterhead band height and page margins (A4). The top margin leaves room for
# the band; the body frame starts below it.
_BAND_HEIGHT = 32 * mm
_SIDE_MARGIN = 20 * mm
_BOTTOM_MARGIN = 18 * mm
_DEFAULT_ACCENT = "#1a1a1a"


def _safe_hex(color: str | None) -> Color:
    if color and isinstance(color, str) and color.startswith("#") and len(color) in (4, 7):
        try:
            return HexColor(color)
        except Exception:
            pass
    return HexColor(_DEFAULT_ACCENT)


def _data_url_to_reader(data_url: str | None):
    if not data_url or "," not in data_url:
        return None
    try:
        raw = base64.b64decode(data_url.split(",", 1)[1])
        return ImageReader(io.BytesIO(raw))
    except Exception:
        return None


def _draw_letterhead(canvas, doc, letterhead: dict, accent: Color) -> None:
    """Painted on every page: logo (if any), company name, tagline, address,
    and a thin accent rule under the band."""
    width, height = A4
    top = height
    y_name = top - 16 * mm

    logo_reader = _data_url_to_reader(letterhead.get("logo_url"))
    text_x = _SIDE_MARGIN
    if logo_reader is not None:
        try:
            iw, ih = logo_reader.getSize()
            target_h = 14 * mm
            target_w = target_h * (iw / ih) if ih else target_h
            # Cap the logo width so a wide logo doesn't collide with the text.
            max_w = 40 * mm
            if target_w > max_w:
                target_w = max_w
                target_h = target_w * (ih / iw) if iw else target_h
            canvas.drawImage(
                logo_reader, _SIDE_MARGIN, top - 10 * mm - target_h,
                width=target_w, height=target_h, mask="auto",
                preserveAspectRatio=True,
            )
            text_x = _SIDE_MARGIN + target_w + 6 * mm
        except Exception:
            pass

    company_name = (letterhead.get("company_name") or "").strip()
    tagline = (letterhead.get("tagline") or "").strip()
    address = (letterhead.get("address") or "").strip()

    canvas.saveState()
    if company_name:
        canvas.setFillColor(accent)
        canvas.setFont("Helvetica-Bold", 15)
        canvas.drawString(text_x, y_name, company_name)
    if tagline:
        canvas.setFillColor(black)
        canvas.setFont("Helvetica-Oblique", 9)
        canvas.drawString(text_x, y_name - 6 * mm, tagline)
    if address:
        canvas.setFillColor(Color(0.4, 0.4, 0.4))
        canvas.setFont("Helvetica", 8)
        # Collapse any newlines in the address onto one line for the band.
        one_line = " · ".join(part.strip() for part in address.splitlines() if part.strip())
        canvas.drawRightString(width - _SIDE_MARGIN, y_name, one_line)

    # Thin accent rule under the band.
    canvas.setStrokeColor(accent)
    canvas.setLineWidth(1.2)
    rule_y = top - _BAND_HEIGHT
    canvas.line(_SIDE_MARGIN, rule_y, width - _SIDE_MARGIN, rule_y)
    canvas.restoreState()


def build_document_pdf(title: str, sections: list[dict], letterhead: dict) -> bytes:
    """Build the PDF bytes. ``letterhead`` is already resolved (document override
    or the company-profile fallback) by the caller."""
    letterhead = letterhead or {}
    accent = _safe_hex(letterhead.get("primary_color"))

    buf = io.BytesIO()
    width, height = A4
    doc = BaseDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=_SIDE_MARGIN,
        rightMargin=_SIDE_MARGIN,
        topMargin=_BAND_HEIGHT + 6 * mm,
        bottomMargin=_BOTTOM_MARGIN,
        title=title or "Document",
    )

    frame = Frame(
        _SIDE_MARGIN, _BOTTOM_MARGIN,
        width - 2 * _SIDE_MARGIN,
        height - _BAND_HEIGHT - 6 * mm - _BOTTOM_MARGIN,
        id="body",
    )

    def on_page(canvas, doc_):
        _draw_letterhead(canvas, doc_, letterhead, accent)

    doc.addPageTemplates([
        PageTemplate(id="main", frames=[frame], onPage=on_page),
    ])

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "DocTitle", parent=styles["Title"], fontName="Helvetica-Bold",
        fontSize=20, leading=24, spaceAfter=14, textColor=black, alignment=TA_LEFT,
    )
    heading_style = ParagraphStyle(
        "DocHeading", parent=styles["Heading2"], fontName="Helvetica-Bold",
        fontSize=13, leading=16, spaceBefore=12, spaceAfter=6, textColor=accent,
    )
    body_style = ParagraphStyle(
        "DocBody", parent=styles["BodyText"], fontName="Helvetica",
        fontSize=10.5, leading=16, spaceAfter=8, textColor=black,
    )

    story: list = []
    if title:
        story.append(Paragraph(_escape(title), title_style))
        story.append(Spacer(1, 4))

    for section in sections or []:
        heading = (section.get("heading") or "").strip()
        body = (section.get("body") or "").strip()
        if heading:
            story.append(Paragraph(_escape(heading), heading_style))
        if body:
            # Each blank-line-separated block becomes its own paragraph so
            # prose keeps its intended breaks.
            for para in _split_paragraphs(body):
                story.append(Paragraph(_escape(para), body_style))

    if not story:
        story.append(Paragraph("This document has no content yet.", body_style))

    doc.build(story)
    return buf.getvalue()


def _split_paragraphs(text: str) -> list[str]:
    blocks = [b.strip() for b in text.replace("\r\n", "\n").split("\n\n")]
    return [b.replace("\n", "<br/>") for b in blocks if b]


def _escape(text: str) -> str:
    """Escape the XML-significant characters reportlab's Paragraph parses,
    while leaving the <br/> tags introduced above intact."""
    return (
        text.replace("&", "&amp;")
        .replace("<br/>", "\x00BR\x00")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\x00BR\x00", "<br/>")
    )
