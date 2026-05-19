import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { rateLimitOr429 } from "@/lib/auth";

/**
 * Content-Security-Policy violation report endpoint.
 *
 * The browser POSTs here automatically when a CSP-Report-Only or CSP
 * (enforcing) header includes `report-uri /api/csp-report`. We store
 * the report in Supabase for later analysis — see migrations/v13_*.sql
 * for the table.
 *
 * # Authentication
 *
 * This endpoint is PUBLIC. It has to be — the browser sends violation
 * reports for every user, including the unauthenticated login page,
 * and including reports before NextAuth has run. We can't gate it on
 * a session.
 *
 * That public-ness is a small abuse vector: a hostile script anywhere
 * on the internet could POST fake reports to flood our table. We
 * mitigate by:
 *   1. Rate limiting per-IP (100/min, generous enough for legit bursts)
 *   2. Capping payload size (CSP reports are small JSON; reject >10KB)
 *   3. Hashing the IP before storage so we don't keep IPs but can
 *      still group by source
 *   4. Allowing this endpoint in proxy.ts's PUBLIC_PATHS list
 *
 * # Content types
 *
 * Browsers send reports in one of two shapes depending on age:
 *   - Legacy: Content-Type: application/csp-report
 *     Body: { "csp-report": { ... } }
 *   - Reporting API: Content-Type: application/reports+json
 *     Body: [{ "type": "csp-violation", "body": { ... }, ... }]
 *
 * We accept either and normalize to a single shape.
 */

// Cap body at 10KB. Legit CSP reports are well under 2KB; anything
// larger is either malformed or abuse.
const MAX_BODY_BYTES = 10 * 1024;

interface CspReportBody {
  "document-uri"?: string;
  documentURL?: string;          // Reporting API variant
  referrer?: string;
  "violated-directive"?: string;
  effectiveDirective?: string;    // Reporting API variant
  "effective-directive"?: string;
  "original-policy"?: string;
  originalPolicy?: string;
  disposition?: string;
  "blocked-uri"?: string;
  blockedURL?: string;            // Reporting API variant
  "status-code"?: number;
  statusCode?: number;
  "script-sample"?: string;
  sample?: string;
  "source-file"?: string;
  sourceFile?: string;
  "line-number"?: number;
  lineNumber?: number;
  "column-number"?: number;
  columnNumber?: number;
}

function pickField<T>(
  body: CspReportBody,
  ...keys: (keyof CspReportBody)[]
): T | undefined {
  for (const key of keys) {
    const v = body[key];
    if (v !== undefined && v !== null && v !== "") {
      return v as T;
    }
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  // Rate limit — generous because legit pages can fire several reports
  // on a single load if multiple resources are blocked.
  const limited = await rateLimitOr429(req, 100, 60_000, "csp-report");
  if (limited) return limited;

  // Reject oversized payloads.
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    // Malformed JSON — silently drop (don't help a fuzzer learn).
    return new NextResponse(null, { status: 204 });
  }

  // Normalize both legacy and Reporting API shapes to a single body object.
  // Legacy: { "csp-report": { ... } }
  // Reporting API: [{ type, body: { ... }, ... }] — possibly multiple entries
  const entries: CspReportBody[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (
        item &&
        typeof item === "object" &&
        "type" in item &&
        (item as { type: string }).type === "csp-violation" &&
        "body" in item
      ) {
        entries.push((item as { body: CspReportBody }).body);
      }
    }
  } else if (raw && typeof raw === "object" && "csp-report" in raw) {
    entries.push((raw as { "csp-report": CspReportBody })["csp-report"]);
  } else if (raw && typeof raw === "object") {
    // Some browsers send the body directly without the wrapper.
    entries.push(raw as CspReportBody);
  }

  if (entries.length === 0) {
    // Couldn't parse anything useful — drop quietly.
    return new NextResponse(null, { status: 204 });
  }

  // Hash the IP for grouping without storing the raw value.
  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  const ipHash = crypto
    .createHash("sha256")
    .update(ip)
    .digest("hex")
    .slice(0, 16); // 8 bytes is enough to distinguish clients in a small set

  const userAgent = req.headers.get("user-agent") ?? null;

  const rows = entries.map((body) => ({
    document_uri: pickField<string>(body, "document-uri", "documentURL") ?? null,
    referrer: body.referrer ?? null,
    violated_directive:
      pickField<string>(body, "violated-directive", "effective-directive", "effectiveDirective") ??
      null,
    effective_directive:
      pickField<string>(body, "effective-directive", "effectiveDirective", "violated-directive") ??
      null,
    original_policy:
      pickField<string>(body, "original-policy", "originalPolicy") ?? null,
    disposition: body.disposition ?? null,
    blocked_uri: pickField<string>(body, "blocked-uri", "blockedURL") ?? null,
    status_code: pickField<number>(body, "status-code", "statusCode") ?? null,
    script_sample: pickField<string>(body, "script-sample", "sample") ?? null,
    source_file: pickField<string>(body, "source-file", "sourceFile") ?? null,
    line_number: pickField<number>(body, "line-number", "lineNumber") ?? null,
    column_number: pickField<number>(body, "column-number", "columnNumber") ?? null,
    user_agent: userAgent,
    ip_hash: ipHash,
    raw: body as unknown as Record<string, unknown>,
  }));

  try {
    await supabase.from("csp_reports").insert(rows);
  } catch {
    // Storage failure is non-critical; we still want to return 204 so
    // the browser doesn't retry-storm.
  }

  // Per spec, the browser doesn't care about the response status — but
  // we return 204 No Content so logs don't fill with noise.
  return new NextResponse(null, { status: 204 });
}

// Reject any non-POST method explicitly.
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
