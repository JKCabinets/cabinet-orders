import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/auth";
import { trackingLinkFor } from "@/lib/carriers";
import {
  cabinetStages, TRACKING_GROUP_LABEL,
  DELIVERY_NOTE_AWAITING, NOTE_NO_CABINETS,
  type CustomerStage,
} from "@/lib/customerFacing";
import type { OrderType } from "@/lib/data";

/**
 * POST /api/public/lookup — "where is my order", for a customer.
 *
 * Contract lives in the header comment of `jk-order-status-page.liquid`, next
 * to the code that consumes it. Section 9.6 of the project handoff puts this
 * question at forty to fifty percent of all customer contact.
 *
 * ⚠ 200 IN EVERY CASE. Never 404 on a miss. A different status, a different
 * shape, OR A DIFFERENT RESPONSE TIME for "no such order" against "wrong
 * email" turns this into an oracle that confirms which order numbers are real.
 * Every path below does the same two queries and returns through the same
 * exit, for that reason and no other.
 *
 * ⚠ CABINETS ONLY IN `stages`, decided 2026-09-01. One project can hold
 * cabinets in production and a sample already delivered, and the page renders
 * ONE step list. Rather than flatten two truths into one status, the step list
 * is the cabinet group and everything else appears as tracking. They cannot
 * overlap: cabinets go by freight to a cross dock and never carry a tracking
 * number.
 */

const ALLOWED_ORIGINS = (process.env.LOOKUP_ALLOWED_ORIGINS
  ?? "https://jkcabinets2you.com,https://www.jkcabinets2you.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * ⚠ CORS IS REQUIRED HERE, UNLIKE THE CLAIM AND CONTACT FORMS. Those post a
 * plain form and take a redirect; this one uses fetch because the answer
 * renders in place, so the browser must be allowed to READ the response.
 */
function corsFor(req: NextRequest): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  const origin = (req.headers.get("origin") ?? "").toLowerCase();
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    base["Access-Control-Allow-Origin"] = origin;
  }
  return base;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsFor(req) });
}

const MAX_BODY_LEN = 2_000;
const MAX_FIELD_LEN = 200;

/** The only body a miss ever produces. Built once so no path can vary it. */
const NOT_FOUND = { found: false } as const;

/**
 * Normalise what a customer types into a project id.
 *
 * They type what their confirmation email showed them -- "ORDER #1035" -- and
 * the OMS stores "SHO-1035". Staff paste "SHO-1035-CAB" out of a log line, so
 * a group suffix is stripped rather than rejected.
 *
 * Returns "" for anything that cannot be a project id, which short-circuits to
 * a miss WITHOUT a database round trip. That is the one deliberate exception
 * to the equal-work rule below: a malformed number reveals nothing about which
 * real orders exist, because it could not have been one either way.
 */
const GROUP_SUFFIXES = ["-CAB", "-HW", "-SMP", "-CST"];

export function normaliseOrderNumber(raw: string): string {
  let s = String(raw ?? "").toUpperCase();
  s = s.replace(/ORDER/g, "").replace(/#/g, "").trim();
  s = s.replace(/\s+/g, "");
  if (!s) return "";
  for (const suffix of GROUP_SUFFIXES) {
    if (s.endsWith(suffix)) { s = s.slice(0, -suffix.length); break; }
  }
  // A bare number is the common case. Anything already prefixed is left alone.
  if (/^\d+$/.test(s)) s = `SHO-${s}`;
  // Only ever look up a project. QUO- and WRN- rows have no project and are
  // not customer-facing purchases.
  if (!/^SHO-[A-Z0-9-]+$/.test(s)) return "";
  return s;
}

/** Date-only columns are "YYYY-MM-DD" with no time. Formatting them through
 *  Date() would parse midnight UTC and render the PREVIOUS day in Phoenix. */
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function formatDateOnly(value: string | null | undefined): string | null {
  const m = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** created_at IS a real timestamp, so this one legitimately resolves in Phoenix. */
function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "America/Phoenix",
  });
}

interface GroupRow {
  type: string;
  stage: string;
  scheduled_delivery_date: string | null;
  customer_email: string | null;
  carrier: string | null;
  tracking_number: string | null;
}

export async function POST(req: NextRequest) {
  const CORS = corsFor(req);
  const json = (body: unknown) =>
    NextResponse.json(body, { status: 200, headers: CORS });

  // ── Body ─────────────────────────────────────────────────────────────────
  let body: { order_number?: unknown; email?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_LEN) return json(NOT_FOUND);
    body = JSON.parse(raw);
  } catch {
    return json(NOT_FOUND);
  }

  const reference = normaliseOrderNumber(
    String(body.order_number ?? "").slice(0, MAX_FIELD_LEN),
  );
  const email = String(body.email ?? "").slice(0, MAX_FIELD_LEN).trim().toLowerCase();

  // ── Rate limiting ────────────────────────────────────────────────────────
  //
  // ⚠ FAILS CLOSED, unlike every other caller. Elsewhere a Redis outage
  // letting requests through means spam; here it means an unthrottled order
  // number oracle. A lookup that stops answering during an outage is a far
  // smaller problem than one that answers without limit.
  //
  // ⚠ TWO BUCKETS, because they stop different attacks. The IP bucket is what
  // limits ENUMERATION -- walking order numbers to learn which are real. The
  // order-number bucket limits GUESSING THE EMAIL on one order somebody
  // already knows, and unlike the IP it cannot be spoofed by a header.
  const ipOk = await checkRateLimit(req, 20, 60_000, "lookup:ip", { failClosed: true });
  if (!ipOk) return json(NOT_FOUND);

  if (reference) {
    const refOk = await checkRateLimit(
      req, 8, 60_000, "lookup:ref", { failClosed: true, subject: reference },
    );
    if (!refOk) return json(NOT_FOUND);
  }

  if (!reference || !email) return json(NOT_FOUND);

  // ── The same two queries on every path ───────────────────────────────────
  //
  // ⚠ NO SHORT-CIRCUIT ON A MISSING PROJECT. Returning early there would make
  // "no such order" one query and "wrong email" two, which is measurable from
  // outside and is precisely the oracle the contract forbids. The group query
  // simply returns nothing for an id that does not exist.
  const [projectRes, groupRes] = await Promise.all([
    supabase.from("projects")
      .select("id, customer_email, created_at")
      .eq("id", reference)
      .maybeSingle(),
    supabase.from("orders")
      .select("type, stage, scheduled_delivery_date, customer_email, carrier, tracking_number")
      .eq("project_id", reference),
  ]);

  const project = projectRes.data;
  const groups = (groupRes.data ?? []) as GroupRow[];

  // ── Does the email match? ────────────────────────────────────────────────
  //
  // ⚠ THE PROJECT'S EMAIL IS NULLABLE; A GROUP'S IS NOT. Matching on the
  // project alone would fail for any purchase whose email did not populate,
  // and fail SILENTLY -- a customer with the right number and the right email
  // told we cannot find their order. Every group must carry one, so they are
  // the reliable half.
  const candidates = [
    project?.customer_email,
    ...groups.map((g) => g.customer_email),
  ];
  const emailMatches = candidates.some(
    (c) => String(c ?? "").trim().toLowerCase() === email && email !== "",
  );

  // ── Build the answer, then decide whether to give it ─────────────────────
  const cabinets = groups.find((g) => g.type === "order");

  const stages: CustomerStage[] = cabinets ? cabinetStages(cabinets.stage) : [];
  const scheduled = cabinets
    ? formatDateOnly(cabinets.scheduled_delivery_date)
    : null;

  const tracking = groups
    .filter((g) => g.type !== "order")
    .map((g) => {
      const link = trackingLinkFor(g.carrier, g.tracking_number);
      if (!link) return null;
      const label = TRACKING_GROUP_LABEL[g.type as OrderType];
      if (!label) return null;
      return {
        label,
        carrier: link.carrier,
        number: String(g.tracking_number).trim(),
        url: link.url,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  let deliveryNote: string | null = null;
  if (!cabinets) deliveryNote = NOTE_NO_CABINETS;
  else if (!scheduled && cabinets.stage !== "Delivered") {
    deliveryNote = DELIVERY_NOTE_AWAITING;
  }

  if (!project || !emailMatches) return json(NOT_FOUND);

  return json({
    found: true,
    reference: project.id,
    placed_on: formatTimestamp(project.created_at),
    scheduled_date: scheduled,
    delivery_note: deliveryNote,
    stages,
    tracking,
    // ⚠ ALWAYS EMPTY. Warranty updates go to the customer by email, decided
    // 2026-09-01 -- push rather than pull, which also removes the enumeration
    // surface a claim lookup would have created. The storefront block is built
    // and correct; it renders nothing while this is empty.
    claims: [],
  });
}
