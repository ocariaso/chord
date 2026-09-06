import { useEffect, useState } from "react";

export interface AccentColor {
  h: number;
  s: number;
  l: number;
  /** Solid hsl(...) string, ready to use as a fill color. */
  css: string;
}

export interface AccentColors {
  primary: AccentColor;
  secondary: AccentColor;
}

/** Used whenever there's no thumbnail (or color extraction fails) — a neutral, non-committal theme. */
export const GRAY_ACCENT_COLORS: AccentColors = {
  primary: { h: 0, s: 0, l: 45, css: "hsl(0, 0%, 45%)" },
  secondary: { h: 0, s: 0, l: 62, css: "hsl(0, 0%, 62%)" },
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

/** Clamp to a saturation/lightness range that stays legible as a solid button fill with white text. */
function toAccentColor(r: number, g: number, b: number): AccentColor {
  const [h, s] = rgbToHsl(r, g, b);
  const clampedS = Math.max(0.5, Math.min(s, 0.85)) * 100;
  const hRounded = Number(h.toFixed(0));
  const sRounded = Number(clampedS.toFixed(0));
  const l = 42;
  return { h: hRounded, s: sRounded, l, css: `hsl(${hRounded}, ${sRounded}%, ${l}%)` };
}

function distSq(a: number[], b: number[]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/** A quick 2-means clustering over sampled pixels, returning the two dominant color clusters. */
function twoDominantColors(pixels: number[][]): { primary: number[]; secondary: number[] } {
  let c1 = pixels[0];
  let c2 = pixels[0];
  let maxDist = -1;
  for (const p of pixels) {
    const d = distSq(p, c1);
    if (d > maxDist) {
      maxDist = d;
      c2 = p;
    }
  }

  for (let iter = 0; iter < 6; iter++) {
    const sum1 = [0, 0, 0];
    const sum2 = [0, 0, 0];
    let n1 = 0;
    let n2 = 0;
    for (const p of pixels) {
      if (distSq(p, c1) <= distSq(p, c2)) {
        sum1[0] += p[0];
        sum1[1] += p[1];
        sum1[2] += p[2];
        n1++;
      } else {
        sum2[0] += p[0];
        sum2[1] += p[1];
        sum2[2] += p[2];
        n2++;
      }
    }
    if (n1 > 0) c1 = [sum1[0] / n1, sum1[1] / n1, sum1[2] / n1];
    if (n2 > 0) c2 = [sum2[0] / n2, sum2[1] / n2, sum2[2] / n2];
  }

  let n1 = 0;
  let n2 = 0;
  for (const p of pixels) {
    if (distSq(p, c1) <= distSq(p, c2)) n1++;
    else n2++;
  }
  return n1 >= n2 ? { primary: c1, secondary: c2 } : { primary: c2, secondary: c1 };
}

/** Samples an image's two most dominant colors and returns legible primary/secondary accent colors. */
export function useDominantColors(imageUrl: string | null): AccentColors | null {
  const [colors, setColors] = useState<AccentColors | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setColors(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        const pixels: number[][] = [];
        for (let i = 0; i < data.length; i += 4) {
          pixels.push([data[i], data[i + 1], data[i + 2]]);
        }
        const { primary, secondary } = twoDominantColors(pixels);
        setColors({
          primary: toAccentColor(primary[0], primary[1], primary[2]),
          secondary: toAccentColor(secondary[0], secondary[1], secondary[2]),
        });
      } catch {
        // A tainted canvas (cross-origin image without CORS headers) just skips the accent colors.
      }
    };
    img.onerror = () => {
      if (!cancelled) setColors(null);
    };
    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return colors;
}
