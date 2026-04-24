import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";

// Public routes that don't need auth
const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/shopify/webhook",
  "/api/cron",
];

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    if (adminRoutes(pathname) && token?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ req, token }) {
        const { pathname } = req.nextUrl;

        // Always allow public paths
        if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return true;

        // Require token for everything else
        return !!token;
      },
    },
  }
);

function adminRoutes(pathname: string) {
  return ["/api/orders/delete", "/api/warranties/delete"].some(r => pathname.startsWith(r));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
