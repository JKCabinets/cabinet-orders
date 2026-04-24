// ─── Types ────────────────────────────────────────────────────────────────────

export type Source = "Shopify" | "Manual";
export type Member = string;
export type Role = "admin" | "member";

export interface TeamMember {
  id: string;
  username: string;
  name: string;
  initials: string;
  role: Role;
  avatarColor: AvatarColor;
  active: boolean;
}

export type AvatarColor = "blue" | "teal" | "amber" | "coral" | "purple" | "rose";

// Use inline styles instead of Tailwind classes — prevents purging
export const AVATAR_COLOR_STYLES: Record<AvatarColor, React.CSSProperties> = {
  blue:   { backgroundColor: "#1e3a5f", color: "#93c5fd", borderColor: "#2563eb" },
  teal:   { backgroundColor: "#134e4a", color: "#5eead4", borderColor: "#0d9488" },
  amber:  { backgroundColor: "#451a03", color: "#fcd34d", borderColor: "#d97706" },
  coral:  { backgroundColor: "#431407", color: "#fdba74", borderColor: "#ea580c" },
  purple: { backgroundColor: "#2e1065", color: "#c4b5fd", borderColor: "#7c3aed" },
  rose:   { backgroundColor: "#4c0519", color: "#fda4af", borderColor: "#e11d48" },
};

export const AVATAR_COLOR_SWATCH_STYLES: Record<AvatarColor, React.CSSProperties> = {
  blue:   { backgroundColor: "#3b82f6" },
  teal:   { backgroundColor: "#14b8a6" },
  amber:  { backgroundColor: "#f59e0b" },
  coral:  { backgroundColor: "#f97316" },
  purple: { backgroundColor: "#8b5cf6" },
  rose:   { backgroundColor: "#f43f5e" },
};

// Keep for backwards compat
export const AVATAR_COLOR_CLASSES: Record<AvatarColor, string> = {
  blue:   "bg-blue-900 text-blue-300 border-blue-700",
  teal:   "bg-teal-900 text-teal-300 border-teal-700",
  amber:  "bg-amber-900 text-amber-300 border-amber-700",
  coral:  "bg-orange-900 text-orange-300 border-orange-700",
  purple: "bg-purple-900 text-purple-300 border-purple-700",
  rose:   "bg-rose-900 text-rose-300 border-rose-700",
};

export const AVATAR_COLOR_SWATCHES: Record<AvatarColor, string> = {
  blue:   "bg-blue-500",
  teal:   "bg-teal-500",
  amber:  "bg-amber-500",
  coral:  "bg-orange-500",
  purple: "bg-purple-500",
  rose:   "bg-rose-500",
};

export const AVATAR_COLOR_OPTIONS: AvatarColor[] = [
  "blue", "teal", "amber", "coral", "purple", "rose",
];

export type OrderStage =
  | "New"
  | "Entered"
  | "In production"
  | "At cross dock"
  | "Delivered";

export type WarrantyStage =
  | "New claim"
  | "In review"
  | "Parts ordered"
  | "Shipped"
  | "Resolved";

export type Stage = OrderStage | WarrantyStage;

export interface ActivityEntry {
  text: string;
  time: string;
}

export interface SkuItem {
  sku: string;
  quantity: number;
  description?: string;
}

export interface Order {
  id: string;
  type: "order" | "warranty";
  name: string;
  source: Source;
  detail: string;
  stage: Stage;
  member: Member;
  date: string;
  sku: string;
  notes: string;
  activity: ActivityEntry[];
  archived?: boolean;
  // Order details
  door_style?: string;
  color?: string;
  sku_items?: SkuItem[];
  // Production timeline
  production_start_date?: string | null;
  production_est_finish_date?: string | null;
}

export const ORDER_STAGES: OrderStage[] = [
  "New", "Entered", "In production", "At cross dock", "Delivered",
];

export const WARRANTY_STAGES: WarrantyStage[] = [
  "New claim", "In review", "Parts ordered", "Shipped", "Resolved",
];

export const STAGE_STATUS: Record<string, "red" | "amber" | "green"> = {
  New: "red", Entered: "amber", "In production": "green",
  "At cross dock": "amber", Delivered: "green",
  "New claim": "red", "In review": "amber", "Parts ordered": "amber",
  "Shipped": "amber", Resolved: "green",
};

export const MEMBER_COLORS: Record<string, string> = {
  AX: "bg-blue-900 text-blue-300 border-blue-700",
  BR: "bg-teal-900 text-teal-300 border-teal-700",
  DN: "bg-amber-900 text-amber-300 border-amber-700",
  CA: "bg-rose-900 text-rose-300 border-rose-700",
};

export const SEED_TEAM: TeamMember[] = [
  { id: "1", username: "ax", name: "Alex",  initials: "AX", role: "admin",  avatarColor: "blue",  active: true },
  { id: "2", username: "br", name: "Brett", initials: "BR", role: "member", avatarColor: "teal",  active: true },
  { id: "3", username: "dn", name: "Dana",  initials: "DN", role: "member", avatarColor: "amber", active: true },
  { id: "4", username: "ca", name: "Casey", initials: "CA", role: "member", avatarColor: "rose",  active: true },
];

export const SEED_ORDERS: Order[] = [];
export const SEED_WARRANTIES: Order[] = [];
