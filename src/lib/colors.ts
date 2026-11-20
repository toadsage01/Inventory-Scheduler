// Booking colours. A booking can wear its own colour — picked in the
// dialog from this palette, where colours already taken by overlapping
// bookings are shown as taken. Null falls back to the booking type's
// colour, then the brand teal. Chips render these as soft pastels on the
// white panel, exactly like the reference board.

export const BOOKING_COLORS = [
  "#3e97d8", // sky blue
  "#de9a45", // peach amber
  "#8e7cc9", // lavender violet
  "#d967a9", // rose pink
  "#46a875", // leaf green
  "#d9b332", // soft mustard
  "#12816e", // brand teal
  "#c65449", // warm coral
];

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Pass through only strict #rrggbb strings; anything else is null. */
export function safeBookingHex(color: string | null | undefined): string | null {
  if (typeof color !== "string") return null;
  const trimmed = color.trim();
  return HEX6.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** The colour a booking paints with: its own, else its type's, else teal. */
export function bookingColor(b: { color?: string | null; typeColor?: string | null }): string {
  return safeBookingHex(b.color) ?? safeBookingHex(b.typeColor) ?? "#12816e";
}

/** Pull a hex toward black — amount 0..1. Longer bookings wear deeper shades. */
export function deepen(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (channel: number) => Math.round(channel * (1 - Math.min(1, Math.max(0, amount))));
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Deterministic chip colour for a team, shown on the booking boards. */
const TEAM_HEX: Record<string, string> = {
  praper: "#e73b45",
  pave: "#de9a45",
  "prave & pave": "#8e7cc9",
};

export function teamColor(name: string | null | undefined): string {
  if (!name) return "#968d92";
  const direct = TEAM_HEX[name.trim().toLowerCase()];
  if (direct) return direct;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const fallbacks = ["#3e97d8", "#46a875", "#d967a9", "#de9a45", "#8e7cc9"];
  return fallbacks[hash % fallbacks.length];
}
