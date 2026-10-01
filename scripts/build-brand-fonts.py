#!/usr/bin/env python3
"""
Rebuild app/fonts/ -- the brand fonts the app serves itself (2026-10-01).

These are what next/font/google used to download from Google at every build:
DM Sans 300-600 upright, Cormorant Garamond 400-600 upright and italic, Latin
and Latin Extended. Built from Google's own repository so they are the same
designs; see OMS-STATE §7, "The build", for why the build no longer fetches
them.

  git clone --filter=blob:none --sparse https://github.com/google/fonts gf
  git -C gf checkout 9710da1eacb3be272583c3224dcb70f9da6eadbb
  git -C gf sparse-checkout set ofl/dmsans ofl/cormorantgaramond
  pip install fonttools brotli          # built with fonttools 4.x
  python3 scripts/build-brand-fonts.py gf/ofl app/fonts

Deterministic: the same sources give byte-identical files (checked 2026-10-01).
"""
import io, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

SRC, OUT = sys.argv[1], sys.argv[2]

# Google Fonts' own subset ranges for latin and latin-ext. The latin one begins
# exactly as the 2026-10-01 failed build quoted it.
LATIN = ("U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,"
         "U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD")
LATIN_EXT = ("U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,"
             "U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,"
             "U+2113,U+2C60-2C7F,U+A720-A7FF")

def build(src, out, limits):
    # ⚠ recalcTimestamp=False THROUGHOUT: fontTools otherwise stamps the save time
    # into head.modified, and two builds of the same sources differ by that alone.
    f = instancer.instantiateVariableFont(TTFont(f"{SRC}/{src}", recalcTimestamp=False), limits)
    f.recalcTimestamp = False
    # Round-trip through bytes: the instanced font's variation table is still
    # lazily loaded, and the subsetter cannot walk it (KeyError on a glyph).
    buf = io.BytesIO(); f.save(buf); buf.seek(0); f = TTFont(buf, recalcTimestamp=False)
    opts = subset.Options()
    opts.layout_features = ["*"]        # every OpenType feature: kerning, ligatures, figures
    opts.name_IDs = ["*"]; opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.flavor = "woff2"
    s = subset.Subsetter(opts)
    s.populate(unicodes=subset.parse_unicodes(LATIN + "," + LATIN_EXT))
    s.subset(f)
    subset.save_font(f, f"{OUT}/{out}", opts)

# ⚠ DM Sans's optical-size axis is PINNED AT ITS DEFAULT, 9. The layout never
# asked Google for optical size, and Google pins an axis nobody asked for at its
# default -- an assumption, checked by comparing screenshots after the first
# deploy. The weight axis is narrowed to what the layout uses.
build("dmsans/DMSans[opsz,wght].ttf", "DMSans-wght300-600.woff2", {"opsz": 9, "wght": (300, 600)})
build("cormorantgaramond/CormorantGaramond[wght].ttf", "CormorantGaramond-wght400-600.woff2", {"wght": (400, 600)})
build("cormorantgaramond/CormorantGaramond-Italic[wght].ttf", "CormorantGaramond-Italic-wght400-600.woff2", {"wght": (400, 600)})
