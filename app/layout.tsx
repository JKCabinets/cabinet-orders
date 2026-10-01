import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { AuthProvider } from "@/components/AuthProvider";
import { ToastProvider } from "@/components/Toast";

// Brand fonts per the JK Cabinets brand guide, SERVED FROM THE REPO (2026-10-01):
// app/fonts/. The CSS variables --font-sans and --font-serif are consumed by
// globals.css and Tailwind exactly as before, so nothing else changed.
//
// ⚠ WHY NOT next/font/google. It downloads the fonts from Google WHILE THE IMAGE
// BUILDS. On 2026-10-01 the deploy of e027ee9 failed inside that download
// (Turbopack: "next/font/google queries have exactly one entry") and the same
// commit built cleanly on a retry -- nothing in the repo had changed, only what
// Google answered. A build that fetches from a third party can fail for a
// reason no commit contains. With these files the build fetches nothing.
//
// What the files are, where they came from, how to rebuild them and their
// licence (OFL, which allows bundling): OMS-STATE §7, "The build".
// The weights are exactly the ones this layout used to ask Google for.
const dmSans = localFont({
  src: [{ path: "./fonts/DMSans-wght300-600.woff2", weight: "300 600", style: "normal" }],
  variable: "--font-sans",
  display: "swap",
  // next/font/google sized its fallback against Arial for a sans; same here.
  adjustFontFallback: "Arial",
});

const cormorant = localFont({
  src: [
    { path: "./fonts/CormorantGaramond-wght400-600.woff2", weight: "400 600", style: "normal" },
    { path: "./fonts/CormorantGaramond-Italic-wght400-600.woff2", weight: "400 600", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
  // ...and against Times New Roman for a serif.
  adjustFontFallback: "Times New Roman",
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
          <StoreProvider><ToastProvider>{children}</ToastProvider></StoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
