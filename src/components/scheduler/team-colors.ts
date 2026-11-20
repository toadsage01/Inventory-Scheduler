// Per-team bar colors on the calendar. Hash the team name so the same
// team always lands on the same color within a session.
export interface TeamColor {
  bar: string;
  dot: string;
  text: string;
}

const PALETTE: TeamColor[] = [
  { bar: "bg-amber-400/90", dot: "bg-amber-400", text: "text-amber-950" },
  { bar: "bg-emerald-400/90", dot: "bg-emerald-400", text: "text-emerald-950" },
  { bar: "bg-rose-400/90", dot: "bg-rose-400", text: "text-rose-950" },
  { bar: "bg-violet-400/90", dot: "bg-violet-400", text: "text-violet-950" },
  { bar: "bg-orange-400/90", dot: "bg-orange-400", text: "text-orange-950" },
  { bar: "bg-teal-400/90", dot: "bg-teal-400", text: "text-teal-950" },
];

const FALLBACK: TeamColor = {
  bar: "bg-slate-400/90",
  dot: "bg-slate-400",
  text: "text-slate-950",
};

export function teamColor(teamName: string | null | undefined): TeamColor {
  if (!teamName) return FALLBACK;
  let hash = 0;
  for (let i = 0; i < teamName.length; i += 1) {
    hash = (hash * 31 + teamName.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
