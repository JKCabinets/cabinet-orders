import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/auth";
import { trackingLinkFor } from "@/lib/carriers";
import {
  cabinetStages, TRACKING_GROUP_LABEL, NOTE_NO_CABINETS,
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
 * ⚠ 200 IN EVERY CASE, WITHOUT EXCEPTION. Never 404 on a miss. A different
 * status, a different shape, or a different response time for "no such order"
 * against "wrong email" turns this into an oracle that confirms which order
 * numbers are real. That includes a 500: `handle()` below is wrapped, because
 * an unhandled database error is a distinguishable response an attacker can
 * provoke, and the first version of this file could return one.
 *
 * ⚠ CABINETS ONLY IN `stages`. One project can hold cabinets in production and
 * a sample already delivered, and the page renders ONE step list. Rather than
 * flatten two truths into one status, the step list is the cabinet group and
 * everything else appears as tracking. They cannot overlap: cabinets go by
 * freight to a cross dock and never carry a tracking number.
 *
 * ⚠ RUNS AS THE SERVICE ROLE. `lib/supabase` is the full-access client, so the
 * only thing keeping customer_phone, ship_to and total_price out of this
 * response is the column list in the query below. The `public_api` role with
 * narrow column grants was designed to be the real boundary and does not exist
 * yet. Until it does, TREAT THE SELECT LISTS AS A SECURITY CONTROL: widening
 * one here has no second check anywhere.
 */

const ALLOWED_ORIGINS = (process.env.LOOKUP_ALLOWED_ORIGINS
  ?? "https://jkcabinets2you.com,https://www.jkcabinets2you.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * ⚠ CORS IS REQUIRED HERE, UNLIKE THE CLAIM AND CONTACT FORMS. Those post a
 * plain form and take a redirect; this one uses fetch because the answer
 * renders in place, so the browser must be allowed to READ the response.
 *
 * No Allow-Credentials: the endpoint authenticates on the body, not a cookie,
 * and echoing credentials back would let a third-party page ride a session.
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

/** The only body a miss ever produces. One constant, so no path can vary it. */
const NOT_FOUND = { found: false } as const;

const GROUP_SUFFIXES = ["-CAB", "-HW", "-SMP", "-CST"];

/**
 * Normalise what a customer types into a project id.
 *
 * They type what their confirmation email showed them -- "ORDER #1035" -- and
 * the OMS stores "SHO-1035". Staff paste "SHO-1035-CAB" out of a log line, so
 * a group suffix is stripped rather than rejected.
 *
 * ⚠ THE FINAL REGEX IS AN INJECTION CONTROL, NOT TIDINESS. PostgREST filters
 * are expressed in the query string, where `,` `.` `(` `)` are syntax. Allowing
 * only A-Z, 0-9 and hyphen is what makes `.eq("id", reference)` safe against a
 * crafted value.
 *
 * Returns "" for anything that cannot be a project id.
 */
export function normaliseOrderNumber(raw: string): string {
  let s = String(raw ?? "").toUpperCase();
  s = s.replace(/ORDER/g, "").replace(/#/g, "").trim();
  s = s.replace(/\s+/g, "");
  if (!s) return "";
  for (const suffix of GROUP_SUFFIXES) {
    if (s.endsWith(suffix)) { s = s.slice(0, -suffix.length); break; }
  }
  if (/^\d+$/.test(s)) s = `SHO-${s}`;
  // Only ever look up a project. QUO- and WRN- rows have no project and are
  // not customer-facing purchases -- which is also what keeps a claimant's
  // name and email unreachable from here.
  if (!/^SHO-[A-Z0-9-]+$/.test(s)) return "";
  return s;
}

/**
 * Date-only columns are "YYYY-MM-DD" with no time. Formatting them through
 * Date() would parse midnight UTC and render the PREVIOUS day in Phoenix.
 */
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
  production_est_finish_date: string | null;
  customer_email: string | null;
  carrier: string | null;
  tracking_number: string | null;
}

async function handle(
  req: NextRequest,
  json: (body: unknown) => NextResponse,
): Promise<NextResponse> {
  // ── IP rate limit, before anything is parsed ─────────────────────────────
  //
  // ⚠ FAILS CLOSED, unlike every other caller. Elsewhere a Redis outage
  // letting requests through means spam; here it means an unthrottled order
  // number oracle. A lookup that stops answering during an outage is a far
  // smaller problem than one that answers without limit.
  //
  // Verified 2026-09-01 to key on the real client IP: fifteen requests bearing
  // fifteen different X-Forwarded-For values shared one bucket, so the header
  // is being replaced by the proxy rather than trusted.
  if (!await checkRateLimit(req, 20, 60_000, "lookup:ip", { failClosed: true })) {
    return json(NOT_FOUND);
  }

  let body: { order_number?: unknown; email?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_LEN) return json(NOT_FOUND);
    body = JSON.parse(raw);
  } catch {
    return json(NOT_FOUND);
  }
  if (!body || typeof body !== "object") return json(NOT_FOUND);

  const reference = normaliseOrderNumber(
    String(body.order_number ?? "").slice(0, MAX_FIELD_LEN),
  );
  const email = String(body.email ?? "").slice(0, MAX_FIELD_LEN).trim().toLowerCase();

  // ⚠ SECOND BUCKET, ON THE ORDER NUMBER. The IP bucket limits ENUMERATION --
  // walking numbers to learn which are real. This one limits GUESSING THE
  // EMAIL on an order somebody already knows, and unlike an IP it cannot be
  // influenced by a request header at all.
  if (reference) {
    if (!await checkRateLimit(
      req, 8, 60_000, "lookup:ref", { failClosed: true, subject: reference },
    )) return json(NOT_FOUND);
  }

  if (!reference || !email) return json(NOT_FOUND);

  // ── The same two queries on every path ───────────────────────────────────
  //
  // ⚠ NO SHORT-CIRCUIT ON A MISSING PROJECT. Returning early would make "no
  // such order" one query and "wrong email" two, which is measurable from
  // outside and is precisely the oracle the contract forbids. The group query
  // returns nothing for an id that does not exist.
  //
  // ⚠ THE SELECT LISTS ARE THE ONLY THING NARROWING SERVICE-ROLE ACCESS.
  // `projects` also holds customer_phone, ship_to and total_price; `orders`
  // holds internal_notes. None of them belong in a public response.
  const [projectRes, groupRes] = await Promise.all([
    supabase.from("projects")
      .select("id, customer_email, created_at")
      .eq("id", reference)
      .maybeSingle(),
    supabase.from("orders")
      // ⚠ ONE STRING LITERAL, NOT A CONCATENATION. supabase-js infers the row
      // type from this argument as a literal type. Splitting it with `+` makes
      // it an expression, inference collapses to GenericStringError[], and the
      // cast below fails to compile. Keep it on one line however long it gets.
      .select("type, stage, scheduled_delivery_date, production_est_finish_date, customer_email, carrier, tracking_number")
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
  const emailMatches = email !== "" && [
    project?.customer_email,
    ...groups.map((g) => g.customer_email),
  ].some((c) => String(c ?? "").trim().toLowerCase() === email);

  // ⚠ THE MISS RETURNS *BEFORE* ANY WORK THAT DEPENDS ON WHAT WAS FOUND.
  //
  // The first version of this file built the whole response and then decided
  // whether to send it, which meant "wrong email" did five stages and a
  // tracking array of work that "no such order" did not. Sub-microsecond
  // against milliseconds of jitter, and still the difference the contract
  // forbids. Both misses now do exactly two queries and return one constant.
  if (!project || !emailMatches) return json(NOT_FOUND);

  const cabinets = groups.find((g) => g.type === "order");

  const scheduled = cabinets
    ? formatDateOnly(cabinets.scheduled_delivery_date)
    : null;

  const stages: CustomerStage[] = cabinets
    ? cabinetStages(cabinets.stage, {
      // ⚠ THE ESTIMATE GOES TO THE NOTE, NEVER TO scheduled_date. The page
      // renders that field as "Delivery booked for …", which would turn a
      // working production date into a delivery commitment.
      estimatedFinish: formatDateOnly(cabinets.production_est_finish_date),
      deliveryScheduled: scheduled !== null,
    })
    : [];

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

  return json({
    found: true,
    reference: project.id,
    placed_on: formatTimestamp(project.created_at),
    scheduled_date: scheduled,
    // ⚠ CABINET ORDERS CARRY PER-STAGE NOTES INSTEAD. This is now only the
    // samples-only case, where there are no steps and it is the whole answer.
    delivery_note: cabinets ? null : NOTE_NO_CABINETS,
    stages,
    tracking,
    // ⚠ ALWAYS EMPTY. Warranty updates go to the customer by email -- push
    // rather than pull, which also removes the enumeration surface a claim
    // lookup would have created. The storefront block is built and correct; it
    // renders nothing while this is empty.
    claims: [],
  });
}

export async function POST(req: NextRequest) {
  const CORS = corsFor(req);
  const json = (body: unknown) =>
    NextResponse.json(body, { status: 200, headers: CORS });
  try {
    return await handle(req, json);
  } catch {
    // ⚠ A 500 IS A DISTINGUISHABLE RESPONSE. Supabase surfaces most failures
    // in `.error` rather than by throwing, but Promise.all rejects on a
    // transport failure, and the unhandled version of this returned a 500 that
    // an attacker could provoke and measure. Nothing is logged here on
    // purpose: the request body holds a customer's email address.
    return json(NOT_FOUND);
  }
}
