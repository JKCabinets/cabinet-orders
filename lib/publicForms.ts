import { supabase } from "@/lib/supabase";

/**
 * The public forms' shared steps -- the quote form and the claims form
 * (2026-11-04, feature 12; SESSION-HANDOFF-2026-11-03.md §7.3).
 *
 * ⚠ WHY THIS EXISTS. On 2026-11-04 Supabase Storage was slow and failing
 * ("Storage issues in us-east-1"): a 100 KB upload took 24 s or hung, both
 * routes waited on it before answering, and kamal-proxy -- which gives up at 30
 * s -- answered the form 504 with no CORS headers. The cut-off attempts still
 * saved, and the customers' retries saved again. So now:
 *   - every step BEFORE the answer is capped, inside one budget well under the
 *     gateway's 30 s, so the answer always comes from the app (requestBudget);
 *   - the files are stored AFTER the answer, each upload retried and capped
 *     below Supabase's own 60 s gateway (uploadWithRetry, afterAnswer).
 *
 * ⚠ AFTER THE ANSWER MEANS IN THIS PROCESS. This box runs one long-lived Node
 * server, so work started before a route returns finishes after the response
 * has gone. A restart mid-upload (a deploy) loses that upload -- accepted
 * (Garrett, 2026-11-04): the record says what never arrived, and support asks
 * the customer.
 */

export const TIMED_OUT: unique symbol = Symbol("timed out");

/** The rest of a request's time, shared by its steps. */
export interface RequestBudget {
  /** Milliseconds left. */
  left(): number;
  /** `work`, or TIMED_OUT if it is not done within `capMs` or what is left, whichever is less. */
  within<T>(work: PromiseLike<T>, capMs: number): Promise<T | typeof TIMED_OUT>;
}

export function requestBudget(totalMs: number): RequestBudget {
  const end = Date.now() + totalMs;
  return {
    left: () => Math.max(0, end - Date.now()),
    within<T>(work: PromiseLike<T>, capMs: number): Promise<T | typeof TIMED_OUT> {
      const ms = Math.min(capMs, end - Date.now());
      // Started once, whatever happens: a builder from @/lib/supabase runs its
      // request each time it is awaited, so it is turned into a promise here.
      const p = Promise.resolve(work);
      if (ms <= 0) { p.catch(() => {}); return Promise.resolve(TIMED_OUT); }
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(TIMED_OUT), ms);
        p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
      });
    },
  };
}

/**
 * Work that carries on after the answer has gone. Never throws into the
 * route: a failure is logged with its label.
 */
export function afterAnswer(label: string, work: () => Promise<unknown>): void {
  void Promise.resolve().then(work).catch((e) => {
    console.error(`[${label}] after the answer: ${(e as Error)?.message ?? String(e)}`);
  });
}

export interface UploadOutcome { error: string | null; attempts: number }

/**
 * One file into Storage, retried. Each attempt is capped below Supabase's own
 * 60 s gateway (it answered "Gateway Timeout" at 61 s on 2026-11-04), with a
 * pause between attempts.
 *
 * ⚠ "ALREADY EXISTS" IS SUCCESS. An attempt this stops waiting for can still
 * land; the next attempt then finds its own file there. Every caller gives each
 * file a path of its own, so the file found is this one.
 */
export async function uploadWithRetry(
  bucket: string,
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
  opts: { attempts?: number; attemptMs?: number; pausesMs?: number[] } = {},
): Promise<UploadOutcome> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const attemptMs = opts.attemptMs ?? 45_000;
  const pauses = opts.pausesMs ?? [3_000, 10_000];
  let last = "not attempted";
  for (let i = 1; i <= attempts; i++) {
    const once = requestBudget(attemptMs);
    try {
      const r = await once.within(supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: false }), attemptMs);
      if (r === TIMED_OUT) last = `no answer from Storage in ${Math.round(attemptMs / 1000)} s`;
      else if (!r.error) return { error: null, attempts: i };
      else if (/already exists|duplicate/i.test(r.error.message ?? "") || String((r.error as { statusCode?: unknown }).statusCode ?? "") === "409") {
        return { error: null, attempts: i };
      } else last = r.error.message || "upload refused";
    } catch (e) {
      last = (e as Error)?.message || "upload failed";
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, pauses[Math.min(i - 1, pauses.length - 1)] ?? 0));
  }
  return { error: last, attempts };
}
