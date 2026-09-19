"""
Font embedding for PPTX export.

Without this, an exported deck falls back to whatever the reviewer has
installed. A deck set in Fraunces arrives in Times New Roman on an investor's
laptop, which undoes most of the design work in one step.

PowerPoint supports embedded fonts through an `embeddedFontLst` in
presentation.xml plus font part files in the package. python-pptx has no API
for this, so the parts are written directly into the underlying OPC package.

Two constraints shape the implementation:
  - PowerPoint expects fntdata format, which is a raw TTF with a small
    header. Modern Google Fonts serve WOFF2, which PowerPoint cannot read,
    so the TTF variant is requested specifically.
  - Not every font permits embedding. The OS/2 fsType flag in the font
    binary says so, and a font that forbids it is skipped rather than
    embedded illegally.
"""
import re
import struct
from dataclasses import dataclass
from pathlib import Path

import httpx

# Where downloaded fonts are cached between exports. Re-fetching a 200KB
# font on every export would add seconds to something a user is waiting on.
CACHE_DIR = Path("/tmp/provisio-fonts")

GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2"

# Asking with an old-browser user agent makes Google serve TTF rather than
# WOFF2, which is the only format PowerPoint will accept.
_TTF_UA = "Mozilla/5.0 (Windows NT 6.1; WOW64)"

# The families each theme font role can resolve to, with the weights a deck
# actually uses. Requesting every weight would triple the embedded size.
FONT_SOURCES: dict[str, dict] = {
    "Fraunces": {"family": "Fraunces", "weights": [400, 600]},
    "Inter": {"family": "Inter", "weights": [400, 600]},
    "Archivo": {"family": "Archivo", "weights": [400, 700]},
    "Source Serif 4": {"family": "Source Serif 4", "weights": [400, 600]},
    "JetBrains Mono": {"family": "JetBrains Mono", "weights": [400]},
    "Playfair Display": {"family": "Playfair Display", "weights": [400, 700]},
    "Space Grotesk": {"family": "Space Grotesk", "weights": [400, 700]},
}


@dataclass
class EmbeddedFont:
    family: str
    weight: int
    data: bytes
    regular: bool


def _cache_path(family: str, weight: int) -> Path:
    safe = re.sub(r"[^A-Za-z0-9]+", "-", family).strip("-")
    return CACHE_DIR / f"{safe}-{weight}.ttf"


def _fetch_ttf(family: str, weight: int) -> bytes | None:
    """Fetches one weight of a Google font as TTF, caching it on disk."""
    path = _cache_path(family, weight)
    if path.exists():
        return path.read_bytes()

    try:
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            css = client.get(
                GOOGLE_FONTS_CSS,
                params={"family": f"{family}:wght@{weight}", "display": "swap"},
                headers={"User-Agent": _TTF_UA},
            )
            if css.status_code != 200:
                return None
            match = re.search(r"url\((https://[^)]+\.ttf)\)", css.text)
            if not match:
                return None
            font = client.get(match.group(1))
            if font.status_code != 200:
                return None
            data = font.content
    except Exception:
        return None

    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except Exception:
        pass  # A cache failure shouldn't fail the export.
    return data


def embedding_allowed(ttf: bytes) -> bool:
    """
    Reads the OS/2 fsType flag to check the licence permits embedding.

    Bit 1 set alone means restricted, which forbids embedding outright.
    Most open fonts report 0 (installable) or 8 (editable), both of which
    permit it. Embedding a restricted font would be a licence violation, so
    an unreadable or restricted font is skipped rather than assumed safe.
    """
    try:
        num_tables = struct.unpack(">H", ttf[4:6])[0]
        for i in range(num_tables):
            offset = 12 + i * 16
            tag = ttf[offset:offset + 4]
            if tag == b"OS/2":
                table_off = struct.unpack(">I", ttf[offset + 8:offset + 12])[0]
                fs_type = struct.unpack(">H", ttf[table_off + 8:table_off + 10])[0]
                # Bit 1 (value 2) is "restricted licence".
                return not (fs_type & 0x0002)
    except Exception:
        return False
    return False


def _to_fntdata(ttf: bytes) -> bytes:
    """
    Wraps a TTF in the fntdata container PowerPoint expects.

    The format is a 32-bit little-endian length followed by the font bytes.
    """
    return struct.pack("<I", len(ttf)) + ttf


def collect_fonts(families: list[str]) -> list[EmbeddedFont]:
    """Fetches and licence-checks every weight of the requested families."""
    out: list[EmbeddedFont] = []
    seen: set[tuple[str, int]] = set()

    for family in families:
        source = FONT_SOURCES.get(family)
        if not source:
            continue
        for weight in source["weights"]:
            key = (family, weight)
            if key in seen:
                continue
            seen.add(key)
            data = _fetch_ttf(source["family"], weight)
            if not data or not embedding_allowed(data):
                continue
            out.append(EmbeddedFont(
                family=family, weight=weight, data=data, regular=(weight < 600),
            ))
    return out


def embed_fonts_in_pptx(pptx_bytes: bytes, families: list[str]) -> tuple[bytes, list[str]]:
    """
    Rewrites a PPTX package with the given fonts embedded.

    Returns the new file and a list of families that could not be embedded,
    so the caller can tell the user rather than letting them discover it on
    someone else's laptop.
    """
    import io
    import zipfile

    fonts = collect_fonts(families)
    embedded_families = {f.family for f in fonts}
    failed = [f for f in families if f not in embedded_families and f in FONT_SOURCES]
    if not fonts:
        return pptx_bytes, failed

    src = zipfile.ZipFile(io.BytesIO(pptx_bytes))
    out_buf = io.BytesIO()

    # Group by family: PowerPoint declares one entry per family with a
    # reference per weight.
    by_family: dict[str, list[EmbeddedFont]] = {}
    for f in fonts:
        by_family.setdefault(f.family, []).append(f)

    font_parts: list[tuple[str, str, bytes]] = []  # (part name, rId, data)
    rid_counter = 9000
    family_entries: list[str] = []

    for family, weights in by_family.items():
        refs: list[str] = []
        for f in weights:
            rid_counter += 1
            rid = f"rIdFont{rid_counter}"
            part = f"ppt/fonts/font{rid_counter}.fntdata"
            font_parts.append((part, rid, _to_fntdata(f.data)))
            tag = "regular" if f.regular else "bold"
            refs.append(f'<p:{tag} r:id="{rid}"/>')
        family_entries.append(
            f'<p:embeddedFont><p:font typeface="{family}" pitchFamily="34" charset="0"/>'
            + "".join(refs)
            + "</p:embeddedFont>"
        )

    embedded_list = "<p:embeddedFontLst>" + "".join(family_entries) + "</p:embeddedFontLst>"

    with zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)

            if item.filename == "ppt/presentation.xml":
                xml = data.decode("utf-8")
                # embeddedFontLst must sit before sldSz per the schema; a
                # misplaced element makes PowerPoint reject the file.
                if "<p:sldSz" in xml:
                    xml = xml.replace("<p:sldSz", embedded_list + "<p:sldSz", 1)
                    xml = xml.replace(
                        "<p:presentation ",
                        '<p:presentation embedTrueTypeFonts="1" ',
                        1,
                    )
                data = xml.encode("utf-8")

            elif item.filename == "ppt/_rels/presentation.xml.rels":
                xml = data.decode("utf-8")
                rels = "".join(
                    f'<Relationship Id="{rid}" '
                    f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" '
                    f'Target="fonts/{part.split("/")[-1]}"/>'
                    for part, rid, _ in font_parts
                )
                xml = xml.replace("</Relationships>", rels + "</Relationships>")
                data = xml.encode("utf-8")

            elif item.filename == "[Content_Types].xml":
                xml = data.decode("utf-8")
                if 'Extension="fntdata"' not in xml:
                    xml = xml.replace(
                        "</Types>",
                        '<Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>',
                    )
                data = xml.encode("utf-8")

            dst.writestr(item, data)

        for part, _, blob in font_parts:
            dst.writestr(part, blob)

    return out_buf.getvalue(), failed


def families_for_pairing(pairing_id: str) -> list[str]:
    """Maps a theme's font pairing onto the families to embed."""
    return {
        "fraunces-inter": ["Fraunces", "Inter"],
        "archivo-inter": ["Archivo", "Inter", "JetBrains Mono"],
        "source-serif": ["Source Serif 4", "Inter"],
        "inter-only": ["Inter"],
        "playfair-inter": ["Playfair Display", "Inter"],
        "space-inter": ["Space Grotesk", "Inter"],
    }.get(pairing_id, ["Inter"])
