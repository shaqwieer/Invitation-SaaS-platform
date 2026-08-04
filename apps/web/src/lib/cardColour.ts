/**
 * The card colour palette, and the one rule that keeps it safe.
 *
 * `cardColor` does two jobs on the invitation: it fills the band behind the
 * artwork, and it tints the occasion's title, which sits on `surface` (#FFFFFF).
 * The band takes any colour — a white band is a seamless frame, a black one
 * letterboxes. The title does not: white on white is an invisible title, and the
 * host would only find out after a guest opened the link.
 *
 * So the palette and the readability guard live together here, and every
 * renderer of a card calls `cardTitleInk()` rather than styling with the raw
 * colour. `InviteScreen` and `CardPreview` are two implementations of the same
 * card; a guard that landed in one and not the other would recreate the bug the
 * comment at the top of `InviteScreen`'s card already apologises for.
 */

/** `surface.DEFAULT` from the Tailwind config — what a card's message sits on. */
const SURFACE = '#FFFFFF';

/** WCAG's floor for large text. Card titles are 26–32px, well past 24px. */
const MIN_CONTRAST = 3;

export const CARD_COLOURS = [
  '#0E5A45',
  '#093127',
  '#A8843C',
  '#8E5F58',
  '#3D4741',
  '#6E5420',
  '#FFFFFF',
  '#000000',
] as const;

function parseHex(colour: string): [number, number, number] | null {
  const hex = colour.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number | null {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return null;

  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The colour to actually paint the title in.
 *
 * Returns the host's choice whenever it can be read on the card, and `ink`
 * otherwise. Only the near-white end of the palette trips this: #A8843C, the
 * lightest of the original six, clears the bar at 3.48:1.
 */
export function cardTitleInk(cardColor: string): string {
  const ratio = contrast(cardColor, SURFACE);
  // An unparseable value is the host's own hex from the colour input; leaving it
  // alone matches what the browser will do with it anyway.
  if (ratio === null) return cardColor;
  return ratio >= MIN_CONTRAST ? cardColor : '#17211D';
}

/**
 * A swatch of pure white is invisible on a white card, so every swatch carries a
 * hairline. Kept here so the wizard and the card editor cannot drift apart.
 */
export const SWATCH_BORDER = 'border border-line-strong';
