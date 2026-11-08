/*
 * What Instagram's own buttons and texts cover on a Reel, as fractions of its 9:16 frame (ADR 0082 § 3): its name and
 * its caption at the bottom, its column of buttons on the right edge, its bar at the top. Approached from the safe
 * zones Meta gives for Reels ads (14 % at the top, 35 % at the bottom) and from a column of buttons a little under an
 * eighth of the width; to be measured at the recette on an iPhone and on an Android with a real Reel open beside the
 * sheet, and corrected here, with the date, never in a setting. Approached, measured at the recette.
 */
export const REEL_ZONES = {
  top: 0.14,
  bottom: 0.35,
  right: 0.12,
} as const;
