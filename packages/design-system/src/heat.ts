/**
 * A fan's desire as fire (copilot, Charles 27/11): the colour at a level of the `nv-heat` track, so the flame and the
 * word take the colour of the tip of the fill. The stops are those of `--nv-fire-*`, cold to burning, never red.
 */

interface FireStop {
  readonly at: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/** Level (0 to 100) and colour of each stop of the ramp, as `--nv-fire-cold`, `-warm`, `-hot`, `-burn`. */
export const FIRE_STOPS: readonly FireStop[] = [
  { at: 0, red: 0x6e, green: 0x7e, blue: 0x96 },
  { at: 35, red: 0xf5, green: 0xc5, blue: 0x42 },
  { at: 65, red: 0xff, green: 0xaa, blue: 0x28 },
  { at: 100, red: 0xff, green: 0x8a, blue: 0x00 },
];

const part = (value: number): string => Math.round(value).toString(16).padStart(2, '0');
const mix = (from: number, to: number, t: number): number => from + (to - from) * t;

/** The colour of the ramp at `level`, clamped to 0..100, as `#rrggbb`. */
export function fireAt(level: number): string {
  const at = Math.min(100, Math.max(0, level));
  let from: FireStop | undefined;
  for (const to of FIRE_STOPS) {
    if (from !== undefined && at <= to.at) {
      const t = (at - from.at) / (to.at - from.at);
      return `#${part(mix(from.red, to.red, t))}${part(mix(from.green, to.green, t))}${part(mix(from.blue, to.blue, t))}`;
    }
    from = to;
  }
  return '#ff8a00';
}
