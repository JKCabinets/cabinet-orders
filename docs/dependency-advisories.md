# Dependency advisory dispositions

Record of dependency-scanner findings that have been **reviewed and consciously
not actioned**, with the reasoning, so a future scan doesn't re-investigate them
from scratch. Reviewed 2026-07-28.

Anything NOT listed here should be treated as un-triaged and investigated.

---

## xlsx (SheetJS) — FALSE POSITIVE, do not act

**Flagged:** CVE-2023-30533 (Prototype Pollution, CWE-1321) · CVE-2024-22363
(ReDoS, CWE-1333).

**Installed:** `xlsx@0.20.3`, sourced from the SheetJS CDN
(`https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz` in package.json), NOT the
npm registry.

**Why it still shows, and why it's a false positive:**
- Prototype Pollution was fixed in SheetJS **0.19.3**. We are on 0.20.3.
- ReDoS was fixed in SheetJS **0.20.2** (per SheetJS's own advisory:
  https://cdn.sheetjs.com/advisories/CVE-2024-22363 — "all versions through
  0.20.1 are affected"). We are on 0.20.3.
- We are above BOTH fixed versions. The flag persists because the `xlsx` package
  on **npmjs.com is frozen at 0.18.5 and abandoned** — SheetJS publishes fixes
  only via their CDN. Scanners keying off the npm registry have no "fixed
  version" to compare against and flag any install named `xlsx`, including a
  patched CDN build. SheetJS documents that Snyk "may report … falsely," and
  there is an upstream tracker issue specifically about `xlsx@0.20.3` + Snyk.

**Exposure even if it were real:** the only `XLSX.read()` (parse) path is the
acknowledgment upload (app/api/orders/[id]/acknowledgment/route.ts), which is
behind staff auth. The export path only WRITES files, which the advisories note
is unaffected regardless.

**Action:** none. If the scanner supports suppression, ignore both CVEs for
`xlsx` with a link to this note. Re-confirm only if the INSTALLED version drops
below 0.20.2.

---

## sharp — Next.js transitive, not reachable

**Flagged:** CWE-122 (heap overflow), CWE-680/CWE-190 (integer overflow),
CWE-125 (out-of-bounds read), all against `sharp@0.34.5`.

**Why not actioned:**
- `sharp` is pulled in solely by `next@16.2.x` for image optimization
  (`npm ls sharp` → `next → sharp`). **Zero direct call sites** in app/lib/
  components (`grep -rn sharp` is empty).
- All flagged issues require processing a **malicious image** through sharp. We
  never pass user-supplied images through it directly; it's Next's surface, not
  ours.

**Action:** none by us. Clears when Next.js bumps its bundled sharp. Tracking
upstream.

---

## postcss@8.4.31 — build-time only, Next.js transitive

**Flagged:** CWE-22 (directory traversal), CWE-79 (XSS), against
`postcss@8.4.31`.

**Why not actioned:**
- Everything WE use is already on `postcss@8.5.14` (autoprefixer, tailwind, and
  our direct dep all dedupe to 8.5.14). The stale 8.4.31 hangs off `next@16.2.x`
  alone (`npm ls postcss`).
- postcss runs at **build time** (CSS processing), never in the running server's
  request path. Reaching these bugs requires feeding postcss malicious CSS at
  build time, i.e. already controlling our source.

**Action:** none. Clears when Next.js bumps its bundled postcss. Tracking
upstream.

---

## Fixed this session (for context, not open items)

- `next-auth` 4.24.14 → **4.24.15** — auth token-integrity patches (CWE-180/345).
- `next` 16.2.6 → **16.2.12** — SSRF / DoS / cache CWEs.
- `xlsx` npm 0.18.5 → **SheetJS CDN 0.20.3** — see above; the two real CVEs are
  fixed, the residual flag is a scanner false positive.
