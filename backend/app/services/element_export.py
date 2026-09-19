"""
Export from the element model.

Elements carry absolute frames on a 1280x720 canvas, which maps cleanly onto
both output formats: 1280x720 px at 96 DPI is exactly 13.333 x 7.5 inches,
the standard 16:9 slide. So a hand-positioned element lands in the exported
file at precisely the position the founder dragged it to, rather than being
re-flowed by a separate layout pass that guesses at their intent.

That exactness is the point. The previous exporter rebuilt each slide from
semantic fields, so any layout work done in the editor was silently
discarded on export.
"""
import base64
import io

from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

CANVAS_W = 1280
CANVAS_H = 720

# 96 px per inch, 914400 EMU per inch.
EMU_PER_PX = 914400 / 96
PT_PER_PX = 72 / 96

TEXT_TYPES = {"text", "heading", "eyebrow", "statement", "caption", "list", "quote", "metric", "pageNumber"}
IMAGE_TYPES = {"image", "logo", "portrait"}


def _px_to_emu(px: float) -> int:
    return int(px * EMU_PER_PX)


def _px_to_pt(px: float) -> float:
    return px * PT_PER_PX


def _hex(value: str | None, fallback: str) -> str:
    v = (value or "").strip()
    if v.startswith("#") and len(v) == 7:
        return v
    if v.startswith("#") and len(v) == 4:
        return "#" + "".join(c * 2 for c in v[1:])
    return fallback


def _mix(a: str, b: str, amount: float) -> str:
    ar, ag, ab = int(a[1:3], 16), int(a[3:5], 16), int(a[5:7], 16)
    br, bg, bb = int(b[1:3], 16), int(b[3:5], 16), int(b[5:7], 16)
    return "#%02x%02x%02x" % (
        round(ar + (br - ar) * amount),
        round(ag + (bg - ag) * amount),
        round(ab + (bb - ab) * amount),
    )


class Theme:
    """Resolves the element model's named colour roles to actual values."""

    def __init__(self, raw: dict):
        self.ink = _hex(raw.get("secondary_color") or raw.get("ink"), "#161412")
        self.paper = _hex(raw.get("paper"), "#faf8f3")
        self.accent = _hex(raw.get("primary_color") or raw.get("accent"), "#b8860b")
        self.muted = _mix(self.ink, self.paper, 0.42)
        self.rule = _mix(self.ink, self.paper, 0.85)
        self.inverse = self.paper
        self.accent_soft = _mix(self.accent, self.paper, 0.88)

    def color(self, token: str | None, fallback: str = "ink") -> str:
        key = token or fallback
        return {
            "ink": self.ink, "paper": self.paper, "accent": self.accent,
            "muted": self.muted, "rule": self.rule, "inverse": self.inverse,
            "accentSoft": self.accent_soft, "none": None,
        }.get(key, key if str(key).startswith("#") else self.ink)


def _data_url_bytes(data_url: str | None) -> bytes | None:
    if not data_url or "," not in data_url:
        return None
    try:
        return base64.b64decode(data_url.split(",", 1)[1])
    except Exception:
        return None


def _slide_background(slide: dict, theme: Theme) -> str:
    bg = slide.get("background") or "paper"
    return {"ink": theme.ink, "accent": theme.accent}.get(bg, theme.paper)


def _sorted_elements(slide: dict) -> list[dict]:
    els = slide.get("elements") or []
    return sorted(els, key=lambda e: (e.get("frame") or {}).get("z", 10))


# ---------------------------------------------------------------------------
# PPTX
# ---------------------------------------------------------------------------

def build_pptx_from_elements(
    deck_name: str,
    slides: list[dict],
    theme_raw: dict,
    chart_images: dict[str, str] | None = None,
) -> bytes:
    chart_images = chart_images or {}
    theme = Theme(theme_raw or {})

    prs = Presentation()
    prs.slide_width = Emu(_px_to_emu(CANVAS_W))
    prs.slide_height = Emu(_px_to_emu(CANVAS_H))
    blank = prs.slide_layouts[6]

    for slide_data in slides:
        slide = prs.slides.add_slide(blank)

        # Background as a full-bleed rectangle, since python-pptx has no
        # direct per-slide background colour on a blank layout.
        from pptx.enum.shapes import MSO_SHAPE
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
        bg.fill.solid()
        bg.fill.fore_color.rgb = RGBColor.from_string(_slide_background(slide_data, theme)[1:].upper())
        bg.line.fill.background()
        bg.shadow.inherit = False

        for el in _sorted_elements(slide_data):
            _add_pptx_element(slide, el, theme, chart_images)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _add_pptx_element(slide, el: dict, theme: Theme, chart_images: dict[str, str]) -> None:
    frame = el.get("frame") or {}
    style = el.get("style") or {}
    etype = el.get("type")

    x, y = _px_to_emu(frame.get("x", 0)), _px_to_emu(frame.get("y", 0))
    w, h = _px_to_emu(frame.get("w", 100)), _px_to_emu(frame.get("h", 40))

    if etype in {"shape", "rule"}:
        from pptx.enum.shapes import MSO_SHAPE
        shape_kind = MSO_SHAPE.OVAL if style.get("shape") == "circle" else MSO_SHAPE.RECTANGLE
        shp = slide.shapes.add_shape(shape_kind, x, y, w, h)
        fill = theme.color(style.get("background"), "accent")
        shp.fill.solid()
        shp.fill.fore_color.rgb = RGBColor.from_string(fill[1:].upper())
        shp.line.fill.background()
        shp.shadow.inherit = False
        return

    if etype == "chart":
        captured = chart_images.get(el.get("id", ""))
        img = _data_url_bytes(captured)
        if img:
            slide.shapes.add_picture(io.BytesIO(img), x, y, w, h)
            return
        # Fall back to a table of the same numbers rather than a blank gap.
        chart = el.get("chart") or {}
        cols, rows = chart.get("columns", []), chart.get("rows", [])
        if cols and rows:
            shape = slide.shapes.add_table(min(len(rows), 12) + 1, len(cols), x, y, w, h)
            table = shape.table
            for ci, col in enumerate(cols):
                table.cell(0, ci).text = str(col)
            for ri, row in enumerate(rows[:12]):
                for ci in range(len(cols)):
                    table.cell(ri + 1, ci).text = str(row[ci]) if ci < len(row) else ""
        return

    if etype in IMAGE_TYPES:
        img = _data_url_bytes(el.get("src"))
        if img:
            slide.shapes.add_picture(io.BytesIO(img), x, y, w, h)
        return

    if etype in TEXT_TYPES:
        text = el.get("text") or ""
        if not text.strip():
            return
        box = slide.shapes.add_textbox(x, y, w, h)
        tf = box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        valign = style.get("verticalAlign")
        tf.vertical_anchor = {
            "middle": MSO_ANCHOR.MIDDLE, "bottom": MSO_ANCHOR.BOTTOM,
        }.get(valign, MSO_ANCHOR.TOP)

        p = tf.paragraphs[0]
        p.text = text
        p.alignment = {
            "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT,
        }.get(style.get("align"), PP_ALIGN.LEFT)

        font = p.font
        font.size = Pt(max(6, _px_to_pt(style.get("fontSize", 18))))
        font.bold = (style.get("fontWeight", 400) or 400) >= 600
        color = theme.color(style.get("color"), "ink")
        if color:
            font.color.rgb = RGBColor.from_string(color[1:].upper())
        # Map the element model's font roles onto families PowerPoint can
        # resolve on a normal machine. The exact webfont won't be installed
        # on the reviewer's computer, so a close, always-present fallback
        # preserves the serif/sans distinction the design depends on.
        family = style.get("fontFamily", "body")
        font.name = {"display": "Georgia", "label": "Consolas"}.get(family, "Calibri")
        return


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

def build_pdf_from_elements(
    deck_name: str,
    slides: list[dict],
    theme_raw: dict,
    chart_images: dict[str, str] | None = None,
) -> bytes:
    chart_images = chart_images or {}
    theme = Theme(theme_raw or {})

    page_w = CANVAS_W * PT_PER_PX
    page_h = CANVAS_H * PT_PER_PX
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=(page_w, page_h))

    for slide_data in slides:
        bg = _slide_background(slide_data, theme)
        c.setFillColor(HexColor(bg))
        c.rect(0, 0, page_w, page_h, stroke=0, fill=1)

        for el in _sorted_elements(slide_data):
            _draw_pdf_element(c, el, theme, chart_images, page_h)

        c.showPage()

    c.save()
    return buf.getvalue()


def _draw_pdf_element(c, el: dict, theme: Theme, chart_images: dict[str, str], page_h: float) -> None:
    frame = el.get("frame") or {}
    style = el.get("style") or {}
    etype = el.get("type")

    x = frame.get("x", 0) * PT_PER_PX
    w = frame.get("w", 100) * PT_PER_PX
    h = frame.get("h", 40) * PT_PER_PX
    # PDF's origin is bottom-left; the canvas model's is top-left.
    y = page_h - (frame.get("y", 0) * PT_PER_PX) - h

    if etype in {"shape", "rule"}:
        fill = theme.color(style.get("background"), "accent")
        if fill:
            c.setFillColor(HexColor(fill))
            if style.get("shape") == "circle":
                c.ellipse(x, y, x + w, y + h, stroke=0, fill=1)
            else:
                c.rect(x, y, w, h, stroke=0, fill=1)
        return

    if etype == "chart":
        img = _data_url_bytes(chart_images.get(el.get("id", "")))
        if img:
            try:
                c.drawImage(ImageReader(io.BytesIO(img)), x, y, w, h,
                            preserveAspectRatio=True, anchor="c", mask="auto")
                return
            except Exception:
                pass
        chart = el.get("chart") or {}
        cols, rows = chart.get("columns", []), chart.get("rows", [])
        if cols:
            c.setFont("Helvetica", 8)
            c.setFillColor(HexColor(theme.muted))
            ty = y + h - 12
            c.drawString(x, ty, "  ".join(str(col) for col in cols))
            for row in rows[:14]:
                ty -= 12
                if ty < y:
                    break
                c.drawString(x, ty, "  ".join(str(cell) for cell in row))
        return

    if etype in IMAGE_TYPES:
        img = _data_url_bytes(el.get("src"))
        if img:
            try:
                c.drawImage(ImageReader(io.BytesIO(img)), x, y, w, h,
                            preserveAspectRatio=(style.get("objectFit") == "contain"),
                            anchor="c", mask="auto")
            except Exception:
                pass
        return

    if etype in TEXT_TYPES:
        text = (el.get("text") or "").strip()
        if not text:
            return
        size = max(5.0, _px_to_pt(style.get("fontSize", 18)))
        bold = (style.get("fontWeight", 400) or 400) >= 600
        family = style.get("fontFamily", "body")
        font_name = _pdf_font(family, bold)
        c.setFont(font_name, size)
        color = theme.color(style.get("color"), "ink")
        c.setFillColor(HexColor(color or theme.ink))

        leading = size * (style.get("lineHeight") or 1.4)
        lines = _wrap(text, w, font_name, size, c)
        align = style.get("align", "left")

        ty = y + h - size
        for line in lines:
            if ty < y - leading:
                break
            if align == "center":
                c.drawCentredString(x + w / 2, ty, line)
            elif align == "right":
                c.drawRightString(x + w, ty, line)
            else:
                c.drawString(x, ty, line)
            ty -= leading


def _pdf_font(family: str, bold: bool) -> str:
    if family == "display":
        return "Times-Bold" if bold else "Times-Roman"
    if family == "label":
        return "Courier-Bold" if bold else "Courier"
    return "Helvetica-Bold" if bold else "Helvetica"


def _wrap(text: str, width: float, font: str, size: float, c) -> list[str]:
    """Wraps text to the element's frame width, honouring explicit newlines."""
    out: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split()
        if not words:
            out.append("")
            continue
        line = words[0]
        for word in words[1:]:
            trial = f"{line} {word}"
            if c.stringWidth(trial, font, size) <= width:
                line = trial
            else:
                out.append(line)
                line = word
        out.append(line)
    return out


def deck_has_elements(slides: list[dict]) -> bool:
    """True when the deck uses the element model, so the caller can fall back
    to the legacy exporter for decks that haven't been opened since the
    migration."""
    return any(s.get("elements") for s in slides)
