const SAMPLE_SIZE = 48;
const MIN_LIGHTNESS = 0.08;
const MAX_LIGHTNESS = 0.95;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A pixel's OKLab lightness and chromatic vector (a, b) — hue is atan2(b, a). */
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const [l_, m_, s_] = [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)];

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

/** Loads an image and returns the OKLCH hue (degrees) of its chroma-weighted average color, or null if it can't be read. */
export function extractDominantHue(imageUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        let sumA = 0;
        let sumB = 0;
        let weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [L, a, b] = rgbToOklab(data[i], data[i + 1], data[i + 2]);
          if (L < MIN_LIGHTNESS || L > MAX_LIGHTNESS) continue;
          const chroma = Math.sqrt(a * a + b * b);
          sumA += a * chroma;
          sumB += b * chroma;
          weight += chroma;
        }

        if (weight === 0) return resolve(null);
        const hue = (Math.atan2(sumB / weight, sumA / weight) * 180) / Math.PI;
        resolve(hue < 0 ? hue + 360 : hue);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}
