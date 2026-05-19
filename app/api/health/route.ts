import { NextResponse } from "next/server";

// Lightweight liveness probe used by Kamal's healthcheck.
//
// Intentionally has no auth, no DB hit, no external dependencies — answers
// "is this Node process serving HTTP?" only. A failing DB or missing env
// var should NOT fail this endpoint, because Kamal uses it during deploys
// to decide when the container is ready to receive traffic, and we'd
// rather see Next.js's own startup errors than a misleading 503 here.
//
// If we ever need a deep healthcheck (e.g., "is Supabase reachable?"),
// add it as a separate route like /api/health/deep.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { status: "ok", timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
