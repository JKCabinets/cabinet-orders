import type { Metadata } from "next";
import { DM_Sans, Cormorant_Garamond } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { AuthProvider } from "@/components/AuthProvider";

// Brand fonts per the JK Cabinets brand guide. next/font fetches these at
// build time and self-hosts them, so no FOIT and no Google Fonts roundtrip
// in production. The CSS variables --font-sans and --font-serif are then
// consumed by globals.css and Tailwind.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "JK Cabinets — Orders",
  description: "Order management system for JK Cabinets",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

/**
 * Force dynamic rendering for every page.
 *
 * Required for nonce-based CSP to work: Next.js's `getScriptNonceFromHeader`
 * only reads the per-request CSP header during dynamic rendering. Static
 * pages would have no per-request header to read from, so the nonce
 * attribute would always be undefined — which is exactly what we were
 * seeing in production HTML (`nonce: $undefined` on every script tag).
 *
 * Cost: no static optimization, no ISR, no CDN cache at the edge for
 * HTML responses. For this app that's zero practical cost — every page
 * is auth-gated and reads fresh from Supabase per request already.
 *
 * Without this line, `await headers()` below isn't enough to trigger
 * Next.js's nonce propagation, even though the docs imply it should be.
 */
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Read x-nonce from request headers. This call has two effects:
  //   1. It opts this layout (and the whole app, since this is the root)
  //      into dynamic rendering, which is REQUIRED for nonce-based CSP —
  //      a nonce baked into a statically rendered page is useless.
  //   2. It signals to Next.js's internal nonce propagation that this
  //      request has a nonce available (set by proxy.ts), so the
  //      framework will apply it to its hydration and chunk-loader
  //      <script> tags automatically.
  //
  // Without this read, Next.js was emitting `<script nonce="">` on the
  // framework chunks — empty nonce attribute = blocked under strict CSP.
  // See vercel/next.js#55638 and the surrounding cluster of issues.
  //
  // We don't currently render any inline scripts of our own, so we don't
  // need to pass nonce anywhere. Just reading it is sufficient.
  await headers();

  return (
    <html lang="en" className={`${dmSans.variable} ${cormorant.variable}`}>
      <body className="antialiased">
        <AuthProvider>
          <StoreProvider>{children}</StoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
