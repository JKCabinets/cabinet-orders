#!/usr/bin/env python3
"""
patch_deploy_health_key.py

Adds HEALTHCHECKS_API_KEY to Kamal's secret list.

⚠ TWO PLACES OR IT REACHES NOTHING. config/deploy.yml says so itself at line
105: "A variable absent from THIS list never reaches the container, however
correct .env.kamal is -- and nothing warns at deploy time."

The panel handles the absence honestly -- it says "Not configured" rather than
showing green -- so a half-done setup is visible rather than silently wrong.
"""

import sys
from pathlib import Path

TARGET = "config/deploy.yml"
ANCHOR = "    - AVIS_API_TOKEN\n"
ADDITION = ("    - AVIS_API_TOKEN\n"
            "    # Read-only. The system-health panel on /dashboard lists every\n"
            "    # check on the account; it never pings, pauses or creates.\n"
            "    - HEALTHCHECKS_API_KEY\n")


def main() -> int:
    p = Path.cwd() / TARGET
    if not p.is_file():
        print(f"ABORT: {TARGET} not found. Run from ~/cabinet-orders.")
        return 1
    text = p.read_text(encoding="utf-8")

    if "HEALTHCHECKS_API_KEY" in text:
        print("Already applied. Nothing to do.")
        return 0

    n = text.count(ANCHOR)
    if n != 1:
        print(f"ABORT -- nothing written: anchor matches {n} time(s), expected 1")
        return 1

    out = text.replace(ANCHOR, ADDITION, 1)

    # Verify what the patch DID: the key is in the SECRET list, not the clear
    # one. A key in `clear:` would be printed by `kamal env`.
    secret_at = out.index("  secret:")
    if out.index("HEALTHCHECKS_API_KEY") < secret_at:
        print("ABORT -- nothing written: the key landed outside the secret list")
        return 1

    p.write_text(out, encoding="utf-8")
    print("  ok   HEALTHCHECKS_API_KEY added to the secret list")
    print(f"\n{TARGET}: {len(text.splitlines())} -> {len(out.splitlines())} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
