import { MathKit } from "@lib/Tools";


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

export function decToRgbVec(dec: number): [number, number, number] {
   return [(dec >> 16) & 255, (dec >> 8) & 255, dec & 255];
}

