import re, sys
path = "/home/garrett/cabinet-orders/lib/store.tsx"
s = open(path, encoding="utf-8").read()
orig = s
log = []

# 0) ensure useRef is imported (the in-flight guard uses it)
if "useRef" not in s.split('from "react"')[0]:
    a = "useCallback, useEffect, ReactNode,"
    if a in s:
        s = s.replace(a, "useCallback, useEffect, useRef, ReactNode,", 1); log.append("import-useRef: added")
    else:
        log.append("import-useRef: ANCHOR NOT FOUND (check React import manually)")
else:
    log.append("import-useRef: already present")

# 1) Extract the initial loader into a shared useCallback (refetchAll) + in-flight guard.
#    Whitespace-tolerant: match from the comment through `}, [status]);`.
NEW_EFFECT = '''  // Shared loader for orders/warranties/team. Used by the initial mount
  // (which shows the spinner) and by realtime reconnect (a background
  // catch-up that must NOT flip the spinner or flash the board). An
  // in-flight guard keeps a flurry of reconnects from stacking refetches.
  const refetchInFlight = useRef(false);
  const refetchAll = useCallback(async (opts?: { showLoading?: boolean }) => {
    if (refetchInFlight.current) return;
    refetchInFlight.current = true;
    if (opts?.showLoading) setLoading(true);
    try {
      const [ordersRes, warrantiesRes, teamRes] = await Promise.all([
        apiCall("/api/orders?type=order"),
        apiCall("/api/orders?type=warranty"),
        apiCall("/api/team"),
      ]);
      if (ordersRes?.data) setOrders(ordersRes.data.map(shapeOrder));
      if (warrantiesRes?.data) setWarranties(warrantiesRes.data.map(shapeOrder));
      if (teamRes?.data) setTeam(teamRes.data.map(shapeTeamMember));
    } finally {
      if (opts?.showLoading) setLoading(false);
      refetchInFlight.current = false;
    }
  }, []);

  // Only load data once session is authenticated
  useEffect(() => {
    if (status !== "authenticated") return;
    refetchAll({ showLoading: true });
  }, [status, refetchAll]);'''

loader_re = re.compile(
    r'[ \t]*// Only load data once session is authenticated\s*\n\s*useEffect\(\(\) => \{.*?\}, \[status\]\);',
    re.DOTALL,
)
if "refetchAll" in s:
    log.append("loader: already extracted")
elif loader_re.search(s):
    s = loader_re.sub(lambda m: NEW_EFFECT, s, count=1); log.append("loader: extracted to refetchAll")
else:
    log.append("loader: ANCHOR NOT FOUND")

# 2) Wire reconnect to the shared loader (background catch-up). Whitespace-tolerant.
recon_re = re.compile(
    r'onReconnect: \(\) => \{.*?// Phase 2 may add an explicit refetch here\.\s*\n\s*\},',
    re.DOTALL,
)
NEW_RECON = '''onReconnect: () => {
      // Catch up on anything missed while disconnected. Background refetch —
      // no spinner, idempotent with the live merges above.
      void refetchAll();
    },'''
if "void refetchAll();" in s:
    log.append("reconnect: already wired")
elif recon_re.search(s):
    s = recon_re.sub(lambda m: NEW_RECON, s, count=1); log.append("reconnect: wired to refetchAll")
else:
    log.append("reconnect: ANCHOR NOT FOUND")

for l in log: print(l)
if any("NOT FOUND" in l for l in log):
    print("ABORTED — no changes written"); sys.exit(1)
if s != orig:
    open(path, "w", encoding="utf-8").write(s); print("WROTE", path)
else:
    print("no changes written")
