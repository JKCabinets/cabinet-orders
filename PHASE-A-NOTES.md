# Phase A — Shell + Dashboard

This patch introduces the new sidebar shell and dashboard layout. The kanban
board has been replaced by per-stage pages reachable via the sidebar.

## What's new

- **Brand-aligned dark glass UI** — sage glass sidebar, Cormorant Garamond
  headlines, italic-storm signature on every page title.
- **Sidebar** (`/components/Sidebar.tsx`) — three collapsible sections:
  Overview (Dashboard, SLA), Orders (5 stages with live counts), Other
  (Warranty, Archive, Admin). Each entry links to its dedicated page.
- **Dashboard** at `/dashboard` — stat card per stage, SLA mini panel,
  Needs Attention strip.
- **Stage pages** at `/orders/new`, `/orders/entered`, `/orders/in-production`,
  `/orders/at-cross-dock`, `/orders/delivered`, `/orders/archived`. Each shows
  the orders in that stage as a grid of cards, with a per-page search, bulk
  select, and the existing modal click-to-open behavior.
- **Warranty** moved to its own page at `/warranty` with stage tabs.
- **Root `/` redirects to `/dashboard`** — bookmarks to old kanban go here.

## What's removed

These components are no longer referenced and have been deleted:

- `components/Board.tsx` (kanban columns)
- `components/StatsBar.tsx` (old top stat bar)
- `components/TopBar.tsx` (replaced by sidebar)
- `components/Controls.tsx` (inlined into each page)
- `components/ArchiveSection.tsx` (replaced by /orders/archived page)

## What's NOT changed (Phase B)

The existing pop-up modals (`OrderModal`, `NewOrderModal`), the per-card
content (`OrderCard`), the bulk action bar, attachment panel, and the order
details inline editor still use the old dark glassmorphism palette. They
work, just don't yet match the brand-aligned chrome.

Phase B will restyle all of these.

## What's NOT changed (Phase C)

- `/sla` dashboard page (sidebar entry is grayed as "Soon")
- Daily Slack digest
- RMA email drafts

## Apply

```powershell
Expand-Archive -Path $HOME\Downloads\cabinet-orders-phase-a.zip -DestinationPath $env:TEMP\cab-a -Force
Copy-Item -Path "$env:TEMP\cab-a\cabinet-orders-phase-a\*" -Destination . -Recurse -Force
Remove-Item -Path "$env:TEMP\cab-a" -Recurse -Force

# Files to remove (no longer used)
Remove-Item components/Board.tsx -ErrorAction SilentlyContinue
Remove-Item components/StatsBar.tsx -ErrorAction SilentlyContinue
Remove-Item components/TopBar.tsx -ErrorAction SilentlyContinue
Remove-Item components/Controls.tsx -ErrorAction SilentlyContinue
Remove-Item components/ArchiveSection.tsx -ErrorAction SilentlyContinue

git add -A
git commit -m "feat: phase A redesign — sidebar shell + dashboard + per-stage pages"
git push
```

## Test cases

1. After deploy, visit the site → should redirect to `/dashboard`
2. Sidebar shows on the left, stage counts populate from your live orders
3. Click "New" in the sidebar → goes to `/orders/new`, shows cards in a grid
4. Click any card → opens the same modal as today (still dark — Phase B)
5. Click "Select" → enter select mode, pick a few cards, bulk action bar
   appears at the bottom (same as today)
6. Click "Warranty" → goes to `/warranty`, stage tabs across the top
7. Click "Archive" → goes to `/orders/archived`, shows archived orders
8. On mobile: hamburger button reveals the sidebar as a drawer
9. Click "SLA" — should be grayed out as "Soon"

## Known small issues

- The "Calendar" and "Shopify" links in the sidebar footer open external URLs
  (Google Calendar, Shopify admin). They previously matched a specific Shopify
  store URL via the old TopBar; you may want to change those targets later.
- The `/admin` page (team management) is still the old dark layout — Phase B
  will wrap it in the new AppShell.
- The `/calendar` page is still the old dark layout — Phase B will wrap it too.
