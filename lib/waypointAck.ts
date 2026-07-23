/**
 * waypointAck.ts — Parse a Waypoint order-acknowledgment .xlsx into a structured
 * ParsedAck for the reconciliation engine.
 *
 * Waypoint's layout (confirmed consistent):
 *   - Sheet name = Waypoint order number; A1 = "Order <num>"
 *   - C1 = "PO: <value>"  → our join key (team enters the SHO number here)
 *   - "Ship To" block: label in col A, name + address lines + phone in col C
 *   - Line-item table starts at the row where A="Group/Style", B="Qty"
 *   - Group/Style header rows (col A, no qty) carry "<grp> - <DOOR>-<COLOR NAME>"
 *     and establish the door+color for the line rows beneath them
 *   - Line rows: B=qty, C=BASE sku (e.g. "W930"), G=list price
 *
 * Our composite is reconstructed as  base-DOOR-COLORCODE  (e.g. W930-410F-PL),
 * mapping the spelled-out color name back to our code via COLOR_NAME_TO_CODE.
 *
 * Uses a SpreadsheetRow[][] abstraction so the caller supplies parsed cells
 * (e.g. via SheetJS/xlsx in the upload route); this module stays I/O-free and
 * unit-testable.
 */
import { doorStyleMap, colorNameToCode } from "@/lib/skuDecoder";

export interface AckLineItem {
  base_sku: string;
  door_code: string;
  color_name: string;
  color_code: string;
  composite_sku: string;
  qty: number;
  list_price: number | null;
}

export interface ParsedAck {
  waypoint_order: string;
  po: string;
  ship_name: string;
  ship_address: string;
  items: AckLineItem[];
}

// A grid of cell values: rows[r][c], 0-indexed, string|number|null.
export type Grid = Array<Array<string | number | null>>;

function s(v: string | number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

export function parseWaypointAck(sheetName: string, grid: Grid): ParsedAck {
  const cell = (r: number, c: number): string =>
    s(grid[r]?.[c]);
  const rawNum = (r: number, c: number): number | null => {
    const v = grid[r]?.[c];
    return typeof v === "number" ? v : v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : null;
  };

  const waypoint_order = sheetName.trim();
  let po = "";
  const poMatch = cell(0, 2).match(/PO:\s*(.+)/);
  if (poMatch) po = poMatch[1].trim();

  // Ship To block
  let ship_name = "";
  const shipLines: string[] = [];
  for (let r = 0; r < grid.length; r++) {
    if (cell(r, 0) === "Ship To") {
      ship_name = cell(r, 2);
      let rr = r + 1;
      while (rr < grid.length && cell(rr, 0) === "" && cell(rr, 2)) {
        shipLines.push(cell(rr, 2));
        rr++;
      }
      break;
    }
  }
  const ship_address = shipLines.join(", ");

  // Line-item header row
  let hdr = -1;
  for (let r = 0; r < grid.length; r++) {
    if (cell(r, 0) === "Group/Style" && cell(r, 1) === "Qty") { hdr = r; break; }
  }

  const items: AckLineItem[] = [];
  let curDoor = "", curColorName = "";
  if (hdr >= 0) {
    for (let r = hdr + 1; r < grid.length; r++) {
      const a = cell(r, 0);
      const qty = rawNum(r, 1);
      const desc = cell(r, 2);
      const price = rawNum(r, 6);

      // Group/Style header: text in col A, no qty
      if (a && qty === null) {
        const m = a.match(/-\s*([0-9]{3}[A-Z]|BUTT)-([A-Z ]+)\s*$/);
        if (m && doorStyleMap()[m[1].trim()]) {
          curDoor = m[1].trim();
          curColorName = m[2].trim();
        }
        // else: room label ("Kitchen"/"Master Bath") — ignore
        continue;
      }

      // Line item: qty present + base sku in desc
      if (qty !== null && desc) {
        // Waypoint spells a manual door modifier with a space ("B24 BUTT");
        // our composite hyphenates it ("B24-BUTT"). Normalize the internal
        // whitespace so the reconstructed composite matches the OMS form.
        const base = desc.trim().replace(/\s+/g, "-");
        const nameToCode = colorNameToCode();
        const colorCode = nameToCode[curColorName.toUpperCase()]
          ?? nameToCode[
              Object.keys(nameToCode).find(
                k => k.toUpperCase() === curColorName.toUpperCase()
              ) ?? ""
            ]
          ?? "";
        const composite = curDoor && colorCode
          ? `${base}-${curDoor}-${colorCode}`
          : base;
        items.push({
          base_sku: base,
          door_code: curDoor,
          color_name: curColorName,
          color_code: colorCode,
          composite_sku: composite,
          qty,
          list_price: price,
        });
      }
    }
  }

  return { waypoint_order, po, ship_name, ship_address, items };
}
