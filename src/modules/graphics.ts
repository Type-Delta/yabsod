import { CheckCache, MathKit } from "@lib/Tools";


/**
 * A 3- or 4-element tuple representing a color in 8-bit RGB(A) components.
 *
 * - Index 0: Red component (0-255)
 * - Index 1: Green component (0-255)
 * - Index 2: Blue component (0-255)
 * - Index 3 (optional): Alpha component (0-1 or 0-255 depending on consumer)
 *
 * @example
 * // Red
 * const red: RgbVec = [255, 0, 0];
 * // Semi-transparent blue (alpha present but ignored for ANSI coloring)
 * const blue50: RgbVec = [0, 0, 255, 0.5];
 */
export type RgbVec = [number, number, number, number?];

/**
 * Blends two RGB colors together with a given ratio.
 * The `ratio` parameter controls the weight of `overlay` color:
 * - `ratio = 0` returns `base` color.
 * - `ratio = 1` returns `overlay` color.
 * - Values in between produce a mix of the two colors.
 * All color components are clamped to the [0, 255] range.
 *
 * @param base - The base color as an `RgbVec`.
 * @param overlay - The overlay color as an `RgbVec`.
 * @param ratio - The blend ratio (0..1) determining the influence of the overlay color.
 */
export function colorMixV(base: RgbVec, overlay: RgbVec, ratio: number): RgbVec {
   return [
      Math.round(base[0] * (1 - ratio) + overlay[0] * ratio),
      Math.round(base[1] * (1 - ratio) + overlay[1] * ratio),
      Math.round(base[2] * (1 - ratio) + overlay[2] * ratio),
   ];
}

/**
 * Blends two colors represented as decimal integers (0xRRGGBB) using a specified ratio.
 * The `ratio` parameter controls the weight of `colorB`:
 * - `ratio = 0` returns `colorA`.
 * - `ratio = 1` returns `colorB`.
 * - Values in between produce a mix of the two colors.
 *
 * @param colorA - The first color as a decimal integer (e.g., 0xff0000 for red).
 * @param colorB - The second color as a decimal integer (e.g., 0x0000ff for blue).
 * @param ratio - The blend ratio (0..1) determining the influence of colorB.
 * @returns The blended color as a decimal integer (0xRRGGBB).
 */
export function colorMixD(colorA: number, colorB: number, ratio: number): number {
   const a = decToRgbVec(colorA);
   const b = decToRgbVec(colorB);
   const t = MathKit.clamp(ratio, 0, 1);

   const r = Math.round(a[0] + (b[0] - a[0]) * t);
   const g = Math.round(a[1] + (b[1] - a[1]) * t);
   const bl = Math.round(a[2] + (b[2] - a[2]) * t);
   return (r << 16) + (g << 8) + bl;
}

export function decToRgbVec(dec: number): RgbVec {
   return [(dec >> 16) & 255, (dec >> 8) & 255, dec & 255];
}

/**
 * Returns `text` decorated with an ANSI 24-bit gradient that interpolates
 * between `colorA` and `colorB` across the character positions defined by
 * `aPos` and `bPos`.
 *
 * Behavior details:
 * - `text` is treated as a sequence of characters; each character receives
 *   an ANSI `\x1b[38;2;<r>;<g>;<b>m` color sequence.
 * - `aPos` and `bPos` are fractional positions in the range [0, 1] that map
 *   to the start and end character indices (inclusive) of the gradient.
 *   Defaults: `aPos = 0`, `bPos = 1` (whole string).
 * - Characters before the start index receive `colorA`; characters after the
 *   end index receive `colorB`; characters within the range are linearly
 *   interpolated per-channel and clamped to [0,255]. The string is reset with
 *   `\x1b[0m` at the end.
 *
 * Important notes / edge-cases:
 * - Input color components are expected to be numeric and roughly in the
 *   0..255 range for the first three entries of `RgbVec`.
 *
 * @param text - The text to apply the gradient to.
 * @param colorA - Starting color as an `RgbVec` (treated as RGB for ANSI).
 * @param colorB - Ending color as an `RgbVec` (treated as RGB for ANSI).
 * @param aPos - Fractional start position of the gradient within `text` (0..1).
 *               Defaults to `0`.
 * @param bPos - Fractional end position of the gradient within `text` (0..1).
 *               Defaults to `1`.
 * @returns A string containing ANSI 24-bit color escape sequences that, when
 *          printed to a compatible terminal, display the requested gradient.
 *
 * @example
 * // Simple full-string gradient from red to green:
 * const out = _2PointGradient('Hello', [255,0,0], [0,255,0]);
 * console.log(out);
 */
export function _2PointGradient(
   text: string,
   colorA: RgbVec,
   colorB: RgbVec,
   aPos = 0,
   bPos = 1
): string {
   if (aPos < 0) aPos = 0;
   else if (bPos > 1) bPos = 1;
   if (!(aPos < bPos) || CheckCache.supportsColor < 3) return text; // no gradient possible

   // calculate gradient indexes
   const len = text.length;
   const startIdx = Math.floor(len * aPos);
   const endIdx = Math.floor(len * bPos);
   const range = endIdx - startIdx;

   // calculate color step deltas
   const deltaR = (colorB[0] - colorA[0]) / range;
   const deltaG = (colorB[1] - colorA[1]) / range;
   const deltaB = (colorB[2] - colorA[2]) / range;

   let result = '';
   for (let i = 0; i < len; i++) {
      if (i < startIdx) {
         result += `\x1b[38;2;${colorA[0]};${colorA[1]};${colorA[2]}m${text[i]}`;
      } else if (i >= startIdx && i <= endIdx) {
         const step = i - startIdx;
         const r = Math.round(MathKit.clamp(colorA[0] + deltaR * step, 0, 255));
         const g = Math.round(MathKit.clamp(colorA[1] + deltaG * step, 0, 255));
         const b = Math.round(MathKit.clamp(colorA[2] + deltaB * step, 0, 255));
         result += `\x1b[38;2;${r};${g};${b}m${text[i]}`;
      } else {
         result += `\x1b[38;2;${colorB[0]};${colorB[1]};${colorB[2]}m${text[i]}`;
      }
   }
   result += `\x1b[0m`; // reset
   return result;
}
