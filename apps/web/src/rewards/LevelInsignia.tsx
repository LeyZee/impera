import { useId, type JSX } from 'react';

import './rewards.css';

/*
 * A rank's insignia (CHF-01, ADR 0104 § 16): a standard of dark glass rimmed in gold, hung point down, that fills
 * up as the rank rises. Chevrons count the first three ranks; a star tops them from the fourth; the last two wear
 * the laurel, the very last its crown. Honorary only: it says a rank, never an amount. Under 40 px the standard
 * fills its box and keeps its main shape alone: the rank's name is always written beside it.
 */

/** The closed list of ranks, the first first (`LEVEL_NAMES` on the server says the same names). */
export const LEVEL_NAMES = [
  'Recrue',
  'Légionnaire',
  'Décurion',
  'Centurion',
  'Tribun',
  'Préfet',
  'Légat',
  'Imperator',
] as const;

/** A rank's name, or `null` for a rank this screen does not draw (a newer server). */
export const levelName = (rank: number): string | null => LEVEL_NAMES[rank - 1] ?? null;

const STANDARD =
  'M20 9h56a3 3 0 0 1 3 3v50.5a3 3 0 0 1-1.3 2.5L49.7 87.6a3 3 0 0 1-3.4 0L18.3 65a3 3 0 0 1-1.3-2.5V12a3 3 0 0 1 3-3z';
const STANDARD_IN = 'M22.5 14h51v47.2L48 81.8 22.5 61.2z';
const HAIRLINE = 'M26 17.5h44v42L48 77.3 26 59.5z';

const round = (value: number): number => Number(value.toFixed(2));

function starPath(cx: number, cy: number, radius: number): string {
  let d = '';
  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI / 5) * index - Math.PI / 2;
    const r = index % 2 === 0 ? radius : radius * 0.45;
    d += `${index === 0 ? 'M' : 'L'}${String(round(cx + r * Math.cos(angle)))} ${String(round(cy + r * Math.sin(angle)))}`;
  }
  return `${d}Z`;
}

/** A chevron, point up, its tip at (48, top). */
function chevronPath(top: number, half: number, rise: number, thick: number): string {
  const l = 48 - half;
  const r = 48 + half;
  return `M48 ${String(top)}L${String(r)} ${String(top + rise)}V${String(round(top + rise + thick))}L48 ${String(round(top + thick))}L${String(l)} ${String(round(top + rise + thick))}V${String(top + rise)}Z`;
}

function Chevrons({
  count,
  top,
  fill,
  tight = false,
}: {
  count: number;
  top: number;
  fill: string;
  /** Under a star: narrower and closer, so three still stand clear of the rim. */
  tight?: boolean;
}): JSX.Element {
  const [step, half, rise, thick] = tight ? [8.6, 14, 7.6, 5] : [10.5, 16, 9, 6.2];
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <path key={index} d={chevronPath(round(top + index * step), half, rise, thick)} fill={fill} />
      ))}
    </>
  );
}

/** One leaf, drawn upright at the origin, then moved and turned. */
function leaf(x: number, y: number, length: number, width: number, turn: number): JSX.Element {
  const h = round(length / 2);
  const w = round(width / 2);
  const k = round(h * 0.45);
  return (
    <path
      key={`${String(round(x))}:${String(round(y))}`}
      d={`M0 ${String(-h)}C${String(w)} ${String(-k)} ${String(w)} ${String(k)} 0 ${String(h)}C${String(-w)} ${String(k)} ${String(-w)} ${String(-k)} 0 ${String(-h)}Z`}
      transform={`translate(${String(round(x))} ${String(round(y))}) rotate(${String(round(turn))})`}
    />
  );
}

/** The laurel around (48, cy): a branch from the foot up, and its mirror. */
function Laurel({ cy, radius, fill }: { cy: number; radius: number; fill: string }): JSX.Element {
  const count = 6;
  const grow = radius / 19.5;
  const leaves: JSX.Element[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = ((22 + (index * 122) / (count - 1)) * Math.PI) / 180;
    const x = 48 - radius * Math.sin(angle);
    const y = cy + radius * Math.cos(angle);
    const tangent = (Math.atan2(-Math.cos(angle), Math.sin(angle)) * 180) / Math.PI;
    leaves.push(leaf(x, y, (10.5 - index * 0.5) * grow, (4.6 - index * 0.2) * grow, tangent - 28));
  }
  return (
    <g fill={fill}>
      <g>{leaves}</g>
      <g transform="translate(96 0) scale(-1 1)">{leaves}</g>
    </g>
  );
}

/** A crown of five points, its base centred on (48, base). */
const CROWN = (base: number): string =>
  `M33 ${String(base)}L30.5 ${String(base - 13)}L38.5 ${String(base - 7.5)}L43 ${String(base - 16)}L48 ${String(base - 8.5)}L53 ${String(base - 16)}L57.5 ${String(base - 7.5)}L65.5 ${String(base - 13)}L63 ${String(base)}Z`;

/** What a rank is drawn with: its light (the gold, or the grey of « pas encore ») and whether it is the small form. */
function Symbol({ rank, light, plain }: { rank: number; light: string; plain: boolean }): JSX.Element {
  if (rank <= 3) {
    const count = plain ? Math.min(rank, 2) : rank;
    return <Chevrons count={count} top={round(44 - count * 5.25 - 2)} fill={light} />;
  }
  if (rank <= 6) {
    const count = rank - 3;
    if (plain) return <path d={starPath(48, 42, 17)} fill={light} />;
    const star = round(33.5 - count * 3.2);
    return (
      <>
        <path d={starPath(48, star, 10)} fill={light} />
        <Chevrons count={count} top={star + 14.5} fill={light} tight />
      </>
    );
  }
  if (plain) return <path d={rank === 7 ? starPath(48, 42, 17) : CROWN(51)} fill={light} />;
  if (rank === 7)
    return (
      <>
        <Laurel cy={41} radius={19.5} fill={light} />
        <path d={starPath(48, 41, 11.5)} fill={light} />
      </>
    );
  return (
    <>
      <g transform="translate(48 30) scale(0.72) translate(-48 -33)">
        <path d={CROWN(33)} fill={light} />
        <rect x={33} y={34.8} width={30} height={3.6} rx={1.2} fill={light} />
      </g>
      <Laurel cy={50.5} radius={15.5} fill={light} />
      <path d={starPath(48, 50.5, 8.6)} fill={light} />
    </>
  );
}

export function LevelInsignia({
  rank,
  earned = true,
  size,
  glow = false,
  className,
}: {
  /** From 1 to 8. */
  rank: number;
  earned?: boolean;
  /** Its side in pixels: under 40 the standard fills its box and the symbol is its main shape alone. */
  size: number;
  /** A neon halo around it: for an insignia shown on its own, never in a list. */
  glow?: boolean;
  className?: string;
}): JSX.Element {
  const id = useId();
  const small = size < 40;
  const frame = small ? 'translate(48 48) scale(1.12) translate(-48 -48)' : undefined;
  const url = (name: string): string => `url(#${id}${name})`;
  const name = levelName(rank) ?? `Rang ${String(rank)}`;
  const common = {
    className: ['rw-trophy', 'rw-level', className].filter(Boolean).join(' '),
    'data-earned': earned,
    viewBox: '0 0 96 96',
    width: size,
    height: size,
    role: 'img',
    'aria-label': `Insigne du rang « ${name} »${earned ? '' : ', pas encore atteint'}`,
  } as const;
  if (!earned)
    return (
      <svg {...common}>
        <g transform={frame}>
          <path d={STANDARD} fill="currentColor" opacity={0.1} />
          <path
            d={STANDARD}
            fill="none"
            stroke="currentColor"
            strokeWidth={small ? 5 : 2.4}
            strokeLinejoin="round"
            opacity={0.5}
          />
          {small ? null : (
            <g opacity={0.42}>
              <Symbol rank={rank} light="currentColor" plain={false} />
            </g>
          )}
        </g>
      </svg>
    );
  return (
    <svg {...common}>
      <defs>
        <linearGradient id={`${id}r`} x1={0.1} y1={0} x2={0.9} y2={1}>
          <stop offset={0} className="rw-stop-hi" />
          <stop offset={0.45} className="rw-stop-mid" />
          <stop offset={1} className="rw-stop-lo" />
        </linearGradient>
        <linearGradient id={`${id}p`} x1={0.5} y1={0} x2={0.5} y2={1}>
          <stop offset={0} className="rw-stop-glass-1" />
          <stop offset={0.55} className="rw-stop-glass-2" />
          <stop offset={1} className="rw-stop-glass-3" />
        </linearGradient>
        <radialGradient id={`${id}n`} cx={0.5} cy={1} r={0.75}>
          <stop offset={0} className="rw-stop-neon" stopOpacity={0.55} />
          <stop offset={1} className="rw-stop-neon" stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${id}y`} x1={0.2} y1={0} x2={0.8} y2={1}>
          <stop offset={0} className="rw-stop-hi" />
          <stop offset={1} className="rw-stop-mid" />
        </linearGradient>
        <radialGradient id={`${id}g`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset={0.5} className="rw-stop-neon" stopOpacity={0.34} />
          <stop offset={1} className="rw-stop-neon" stopOpacity={0} />
        </radialGradient>
        <clipPath id={`${id}k`}>
          <path d={STANDARD_IN} />
        </clipPath>
      </defs>
      {glow && !small ? <circle className="rw-glow" cx={48} cy={48} r={48} fill={url('g')} /> : null}
      <g transform={frame}>
        <path d={STANDARD} fill={url('r')} />
        <path d={STANDARD_IN} fill={url('p')} />
        <path d={STANDARD_IN} fill={url('n')} />
        {small ? null : <path className="rw-mid" d={HAIRLINE} strokeWidth={0.8} opacity={0.5} />}
        <g clipPath={url('k')}>
          <path d="M16 8h64v20c-18 6.5-46 6.5-64 0z" fill="#fff" opacity={0.1} />
        </g>
        <Symbol rank={rank} light={url('y')} plain={small} />
      </g>
    </svg>
  );
}
