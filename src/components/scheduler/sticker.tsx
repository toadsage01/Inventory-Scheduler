"use client";

// The sticker portrait — the clean circular cut, as agreed. Every face
// renders as a crisp circle with the white ring and the soft drop
// shadow. The die-cut polygon machinery is kept one prop away (`round`
// = false) in case the studio wants the irregular cut back later.

import Image from "next/image";

interface StickerPfpProps {
  pfp?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
  tilt?: boolean;
  /** Give this face its own deterministic tilt + size (sticker-sheet feel). */
  variable?: boolean;
  /** Explicit seed for the variance; defaults to the pfp path or the name. */
  seed?: string | null;
  /** Circular cut (default). Pass false for the irregular die-cut shape. */
  round?: boolean;
}

// Ten cat faces, like the sticker sheet on the studio wall.
const CAT_FACES = ["😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾", "🐱"];

// Pastel chips in the colours of that sticker sheet.
const CHIP_COLORS = ["#fde9c8", "#f5dcc4", "#f9c9c4", "#f7c6d8", "#cde8d4", "#dcc9f0", "#fbe3a9", "#c8ddf5"];

function hashSeed(text: string): number {
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  }
  return seed;
}

/** Small deterministic PRNG so a given seed always cuts the same outline. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POLY_CACHE = new Map<string, string>();
const POLY_CACHE_MAX = 400;

/**
 * The silhouette itself: 16 points around the circle, each pushed and
 * pulled by two overlapping sine waves plus per-point jitter — the waves
 * give the outline its long, organic sweeps, the jitter adds the small
 * snips of a hand with scissors. Radius stays within 38–57% so the face
 * is never beheaded and the sticker never goes square.
 */
function dieCutPolygon(seedText: string): string {
  const cached = POLY_CACHE.get(seedText);
  if (cached) return cached;

  const rand = mulberry32(hashSeed(seedText.toLowerCase() || "?"));
  const points = 16;
  const phaseA = rand() * Math.PI * 2;
  const phaseB = rand() * Math.PI * 2;
  const sweepA = 4 + rand() * 4.5; // long wave: 4–8.5% of the box
  const sweepB = 1.5 + rand() * 3; // short wave: 1.5–4.5%
  const pts: string[] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    const wobble =
      50 + Math.sin(angle * 2 + phaseA) * sweepA + Math.sin(angle * 3 + phaseB) * sweepB + (rand() - 0.5) * 4.5;
    const radius = Math.max(38, Math.min(57, wobble));
    const x = (50 + radius * Math.cos(angle)).toFixed(2);
    const y = (50 + radius * Math.sin(angle)).toFixed(2);
    pts.push(`${x}% ${y}%`);
  }
  const polygon = `polygon(${pts.join(", ")})`;

  if (POLY_CACHE.size >= POLY_CACHE_MAX) POLY_CACHE.clear();
  POLY_CACHE.set(seedText, polygon);
  return polygon;
}

export function avatarArt(name: string | null | undefined): { emoji: string; background: string } {
  const seed = hashSeed((name ?? "?").toLowerCase() || "?");
  return {
    emoji: CAT_FACES[seed % CAT_FACES.length],
    background: CHIP_COLORS[Math.floor(seed / 7) % CHIP_COLORS.length],
  };
}

/** Deterministic per-seed variance: tilt -5..5 degrees, scale 0.92..1.10. */
export function stickerVariance(seed: string | null | undefined): { tilt: number; scale: number } {
  const s = hashSeed(seed ?? "?");
  const tilt = Math.round(((s % 100) / 100 * 10 - 5) * 10) / 10;
  const scale = Math.round((0.92 + ((Math.floor(s / 13) % 100) / 100) * 0.18) * 100) / 100;
  return { tilt, scale };
}

// The die-cut face stickers shipped in public/faces: the PNG already
// carries its own white outline and transparent background, so these
// render RAW — no circle clip, no extra ring — exactly like the die-cut
// sticker sheet. Uploaded photos keep the circular cut.
const DIE_CUT_RE = /^\/faces\/sticker-\d+\.png$/;

export function StickerPfp({ pfp, name, size = 24, className = "", tilt = false, variable = false, seed, round = true }: StickerPfpProps) {
  if (pfp && DIE_CUT_RE.test(pfp)) {
    // Slightly larger box so the sticker's own outline reads at chip size.
    const box = Math.round(size * 1.18);
    return (
      <span
        className={`inline-flex shrink-0 select-none items-center justify-center ${className}`}
        style={{ width: box, height: box, minWidth: box, filter: "drop-shadow(0 1px 2.5px rgba(0,0,0,0.28))" }}
        aria-hidden
      >
        <Image src={pfp} alt="" width={box} height={box} unoptimized className="block h-full w-full object-contain" />
      </span>
    );
  }

  const seedText = seed ?? pfp ?? name;
  const polygon = round ? "circle(50%)" : dieCutPolygon(seedText ?? "?");
  // The white cut-edge: a touch wider on big faces, hair-thin on chips.
  const ring = Math.max(2, Math.round((size / 9) * 2) / 2);

  const variance = variable ? stickerVariance(seedText) : null;
  const rotation = variance ? variance.tilt : tilt ? -4 : 0;
  const scale = variance ? variance.scale : 1;

  // drop-shadow on the wrapper traces the clipped silhouette — a regular
  // box-shadow would be cut away by the clip-path.
  const wrapperStyle: React.CSSProperties = {
    width: size + ring * 2,
    height: size + ring * 2,
    minWidth: size + ring * 2,
    filter: "drop-shadow(0 1px 2.5px rgba(0,0,0,0.30))",
    transform: rotation !== 0 || scale !== 1 ? `rotate(${rotation}deg) scale(${scale})` : undefined,
  };
  const edgeStyle: React.CSSProperties = {
    clipPath: polygon,
    background: "#ffffff",
    padding: ring,
  };
  const faceStyle: React.CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    clipPath: polygon,
  };

  return (
    <span className={`inline-flex shrink-0 select-none ${className}`} style={wrapperStyle} aria-hidden>
      <span className="block" style={edgeStyle}>
        {pfp ? (
          <Image
            src={pfp}
            alt=""
            width={size}
            height={size}
            unoptimized
            className="block object-cover"
            style={faceStyle}
          />
        ) : (
          (() => {
            const art = avatarArt(name);
            return (
              <span
                className="flex items-center justify-center overflow-hidden"
                style={{ ...faceStyle, background: art.background, fontSize: Math.round(size * 0.66), lineHeight: 1 }}
              >
                <span style={{ transform: "translateY(-0.5px)" }}>{art.emoji}</span>
              </span>
            );
          })()
        )}
      </span>
    </span>
  );
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
