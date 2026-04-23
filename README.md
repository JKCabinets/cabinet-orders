# Cabinet Orders

A production-ready order management system for cabinet businesses. Built with Next.js 14, TypeScript, and Tailwind CSS.

## Features

- **Kanban board** — 5-stage pipeline: New → Entered → In production → At cross dock → Delivered
- **Warranty tab** — parallel pipeline: New claim → In review → Parts ordered → Repair scheduled → Resolved
- **Order detail panel** — click any card to view details, move stage, edit notes, and see full activity log
- **Shopify webhook** — auto-ingests new orders from your Shopify store
- **Search & filters** — search by name, order ID, or SKU; filter by source or team member
- **REST API** — full CRUD endpoints for orders and warranties

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .env.example .env.local

# 3. Fill in your env vars (see below)
# 4. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

See `.env.example` for the full list. Key ones:

| Variable | Description |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | `your-store.myshopify.com` |
| `SHOPIFY_ADMIN_API_TOKEN` | Admin API access token from Shopify |
| `SHOPIFY_WEBHOOK_SECRET` | Webhook signing secret (from Shopify webhook settings) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |

---

## Shopify Integration

### 1. Create a Shopify Webhook

1. Go to **Shopify Admin → Settings → Notifications → Webhooks**
2. Click **Create webhook**
3. Set event to **Order creation**
4. Set URL to `https://yourdomain.com/api/shopify/webhook`
5. Copy the **Signing secret** → set as `SHOPIFY_WEBHOOK_SECRET`

### 2. How it works

When an order is placed in your Shopify store:
1. Shopify sends a POST to `/api/shopify/webhook`
2. The handler verifies the HMAC signature
3. The order is transformed and saved to your database
4. It appears in the **New** column on the board tagged as **Shopify**

The webhook handler is in `app/api/shopify/webhook/route.ts`. Look for the `// TODO` comments to swap in your database calls.

---

## Database Setup (Supabase — recommended)

### 1. Create tables

```sql
-- Orders
create table orders (
  id text primary key,
  shopify_id text,
  name text not null,
  source text not null default 'Manual',
  detail text,
  stage text not null default 'New',
  member text,
  sku text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- Warranties
create table warranties (
  id text primary key,
  name text not null,
  source text not null default 'Manual',
  detail text,
  stage text not null default 'New claim',
  member text,
  sku text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Activity log
create table order_activity (
  id bigserial primary key,
  order_id text references orders(id),
  text text not null,
  created_at timestamptz default now()
);
```

### 2. Wire up Supabase in API routes

Install the client:
```bash
npm install @supabase/supabase-js
```

Then in any API route, replace the `// TODO` stubs:
```ts
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET
const { data } = await supabase.from("orders").select("*");

// PATCH stage
await supabase.from("orders")
  .update({ stage: newStage, updated_at: new Date().toISOString() })
  .eq("id", orderId);
```

---

## Project Structure

```
cabinet-orders/
├── app/
│   ├── layout.tsx              # Root layout + font loading
│   ├── page.tsx                # Main app shell
│   ├── globals.css             # Global styles + animations
│   └── api/
│       ├── orders/
│       │   ├── route.ts        # GET /api/orders, POST /api/orders
│       │   └── [id]/route.ts   # GET/PATCH/DELETE /api/orders/:id
│       ├── warranties/
│       │   └── route.ts        # GET /api/warranties, POST /api/warranties
│       └── shopify/
│           └── webhook/
│               └── route.ts    # POST /api/shopify/webhook
├── components/
│   ├── TopBar.tsx              # Header + tab switcher
│   ├── StatsBar.tsx            # Summary stat cards
│   ├── Controls.tsx            # Search, filters, new order button
│   ├── Board.tsx               # Kanban board + columns
│   ├── OrderCard.tsx           # Individual card
│   ├── OrderModal.tsx          # Detail panel (right-side drawer)
│   └── NewOrderModal.tsx       # Create order modal
├── lib/
│   ├── data.ts                 # Types, constants, seed data
│   └── store.tsx               # React Context state management
├── .env.example
├── tailwind.config.ts
└── README.md
```

---

## Deployment

### Vercel (recommended)

```bash
npm install -g vercel
vercel
```

Set your env vars in the Vercel dashboard under **Project → Settings → Environment Variables**.

Your webhook URL will be: `https://your-project.vercel.app/api/shopify/webhook`

### Other platforms

Any platform that supports Next.js 14 works: Railway, Render, Fly.io, AWS Amplify.

---

## Adding Auth

For team logins (so each AX/BR/DN/CA has their own session):

```bash
npm install next-auth
```

See [next-auth.js.org](https://next-auth.js.org) for setup. Recommended providers: **Credentials** (username/password) or **Google** for your team's GSuite accounts.

---

## Email Ingestion (orders@ inbox)

To auto-log orders from your `orders@` inbox:

1. Set up **Postmark** inbound webhooks or **Zapier** Gmail → Webhook
2. POST parsed email data to `/api/orders` with `source: "Manual"`
3. The order appears in the **New** column instantly

---

## Tech Stack

- [Next.js 14](https://nextjs.org/) — App Router, API routes
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Lucide React](https://lucide.dev/) — icons
- [clsx](https://github.com/lukeed/clsx) — conditional classnames
