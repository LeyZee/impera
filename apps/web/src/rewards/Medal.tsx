import { useId, type JSX } from 'react';

import { medalLabel, type TierMedal } from './metals';
import './rewards.css';

/*
 * A tier's medal (CHF-01, ADR 0104 note « médailles »): a Roman coin engraved with the tier's place, in its laurel.
 * From 40 px the coin wears its wreath; under it the coin stands alone, its numeral larger. Its metals are the
 * tokens of `rewards.css`; every instance carries its own gradient ids. Display only.
 */

const CX = 48;
const round = (value: number): number => Number(value.toFixed(2));

interface Leaf {
  readonly d: string;
  readonly transform: string;
}

/** One leaf, drawn upright at the origin, then moved and turned. */
function leaf(x: number, y: number, length: number, width: number, turn: number): Leaf {
  const h = round(length / 2);
  const w = round(width / 2);
  const k = round(h * 0.45);
  return {
    d: `M0 ${String(-h)}C${String(w)} ${String(-k)} ${String(w)} ${String(k)} 0 ${String(h)}C${String(-w)} ${String(k)} ${String(-w)} ${String(-k)} 0 ${String(-h)}Z`,
    transform: `translate(${String(round(x))} ${String(round(y))}) rotate(${String(round(turn))})`,
  };
}

/** The left branch of the wreath around (48, cy), from the foot up; the right one is its mirror. */
function branch(cy: number): readonly Leaf[] {
  const radius = 36;
  const count = 8;
  const leaves: Leaf[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = ((18 + (index * 132) / (count - 1)) * Math.PI) / 180;
    const x = CX - radius * Math.sin(angle);
    const y = cy + radius * Math.cos(angle);
    const tangent = (Math.atan2(-Math.cos(angle), Math.sin(angle)) * 180) / Math.PI;
    const grow = 1 - index * 0.035;
    leaves.push(
      leaf(x - 2.6 * Math.sin(angle), y + 2.6 * Math.cos(angle), 12 * grow, 5.2 * grow, tangent - 26),
      leaf(x + 2.4 * Math.sin(angle), y - 2.4 * Math.cos(angle), 11.04 * grow, 4.68 * grow, tangent + 24),
    );
  }
  return leaves;
}

function Wreath({ cy, fill }: { cy: number; fill: string }): JSX.Element {
  const leaves = branch(cy).map((one) => <path key={one.transform} d={one.d} transform={one.transform} />);
  return (
    <g className="rw-wreath" fill={fill}>
      <g>{leaves}</g>
      <g transform={`translate(${String(2 * CX)} 0) scale(-1 1)`}>{leaves}</g>
    </g>
  );
}

/** I, II or III between two serifs. */
function Numeral({ count, cy }: { count: number; cy: number }): JSX.Element {
  const bar = 3.6;
  const gap = 7.4;
  const height = 17;
  const total = (count - 1) * gap + bar;
  const serif = total + 6.4;
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <rect
          key={index}
          x={round(CX - total / 2 + index * gap)}
          y={cy - height / 2}
          width={bar}
          height={height}
          rx={0.5}
        />
      ))}
      <rect x={round(CX - serif / 2)} y={cy - height / 2 - 1} width={round(serif)} height={2.7} rx={1.1} />
      <rect x={round(CX - serif / 2)} y={cy + height / 2 - 1.7} width={round(serif)} height={2.7} rx={1.1} />
    </>
  );
}

function starPath(cy: number, radius: number): string {
  let d = '';
  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI / 5) * index - Math.PI / 2;
    const r = index % 2 === 0 ? radius : radius * 0.42;
    d += `${index === 0 ? 'M' : 'L'}${String(round(CX + r * Math.cos(angle)))} ${String(round(cy + r * Math.sin(angle)))}`;
  }
  return `${d}Z`;
}

/** The tier's place on the coin: I, II, III, then a star from the fourth. */
function Emblem({ rank, cy, scale }: { rank: number; cy: number; scale: number }): JSX.Element {
  return (
    <g
      transform={`translate(${String(CX)} ${String(cy)}) scale(${String(scale)}) translate(${String(-CX)} ${String(-cy)})`}
    >
      {rank >= 4 ? <path d={starPath(cy, 11.5)} /> : <Numeral count={Math.max(1, rank)} cy={cy} />}
    </g>
  );
}

export function Medal({
  medal,
  earned = true,
  size,
  glow = false,
  className,
}: {
  medal: TierMedal;
  earned?: boolean;
  /** Its side in pixels: under 40 the coin stands alone. */
  size: number;
  /** A halo around it: for a medal shown on its own, never in a list (and never in Day, `rewards.css`). */
  glow?: boolean;
  className?: string;
}): JSX.Element {
  const id = useId();
  const small = size < 40;
  const cy = small ? 48 : 49;
  const coin = small ? 44 : 26;
  const face = small ? 37 : 22.2;
  const scale = small ? 1.75 : 1;
  const url = (name: string): string => `url(#${id}${name})`;
  const common = {
    className: ['rw-medal', className].filter(Boolean).join(' '),
    'data-metal': medal.metal,
    'data-earned': earned,
    viewBox: '0 0 96 96',
    width: size,
    height: size,
    role: 'img',
    'aria-label': medalLabel(medal, earned),
  } as const;
  if (!earned)
    return (
      <svg {...common} fill="currentColor">
        {small ? (
          <>
            <circle cx={CX} cy={cy} r={40} opacity={0.12} />
            <circle cx={CX} cy={cy} r={40} fill="none" stroke="currentColor" strokeWidth={6} opacity={0.5} />
            <g opacity={0.5}>
              <Emblem rank={medal.rank} cy={cy} scale={scale} />
            </g>
          </>
        ) : (
          <>
            <g opacity={0.34}>
              <Wreath cy={cy} fill="currentColor" />
            </g>
            <circle cx={CX} cy={cy} r={24.5} opacity={0.08} />
            <circle
              cx={CX}
              cy={cy}
              r={24.5}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              opacity={0.5}
            />
            <g opacity={0.42}>
              <Emblem rank={medal.rank} cy={cy} scale={scale} />
            </g>
          </>
        )}
      </svg>
    );
  return (
    <svg {...common}>
      <defs>
        <linearGradient id={`${id}a`} x1={0.1} y1={0} x2={0.9} y2={1}>
          <stop offset={0} className="rw-stop-leaf" />
          <stop offset={0.45} className="rw-stop-mid" />
          <stop offset={1} className="rw-stop-lo" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1={0.9} y1={1} x2={0.1} y2={0}>
          <stop offset={0} className="rw-stop-hi" />
          <stop offset={0.5} className="rw-stop-mid" />
          <stop offset={1} className="rw-stop-lo" />
        </linearGradient>
        <radialGradient id={`${id}c`} cx={0.34} cy={0.28} r={0.8}>
          <stop offset={0} className="rw-stop-hi" />
          <stop offset={0.5} className="rw-stop-mid" />
          <stop offset={1} className="rw-stop-lo" />
        </radialGradient>
        <radialGradient id={`${id}g`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset={0.45} className="rw-stop-glow" stopOpacity={0.5} />
          <stop offset={1} className="rw-stop-glow" stopOpacity={0} />
        </radialGradient>
        <clipPath id={`${id}k`}>
          <circle cx={CX} cy={cy} r={face} />
        </clipPath>
      </defs>
      {glow && !small ? <circle className="rw-glow" cx={CX} cy={cy} r={47} fill={url('g')} /> : null}
      {small ? null : (
        <>
          <Wreath cy={cy} fill={url('a')} />
          <path
            d="M43.5 84.5c1.5-2.5 3-3 4.5-3s3 .5 4.5 3c-1.5 1.3-3 1.8-4.5 1.8s-3-.5-4.5-1.8z"
            fill={url('a')}
          />
        </>
      )}
      <circle cx={CX} cy={cy} r={coin} fill={url('b')} />
      {small ? null : (
        <circle
          className="rw-lo"
          cx={CX}
          cy={cy}
          r={24.6}
          strokeWidth={1.5}
          strokeDasharray=".7 1.55"
          opacity={0.55}
        />
      )}
      <circle cx={CX} cy={cy} r={face} fill={url('c')} />
      <circle className="rw-lo" cx={CX} cy={cy} r={face - 0.6} strokeWidth={small ? 2 : 0.9} opacity={0.45} />
      {small ? null : (
        <circle
          className="rw-lo"
          cx={CX}
          cy={cy}
          r={18.8}
          strokeWidth={1.15}
          strokeDasharray=".1 3.28"
          strokeLinecap="round"
          opacity={0.8}
        />
      )}
      <g className="rw-hi" transform={`translate(${small ? '1.3 1.6' : '0.7 0.9'})`} opacity={0.7}>
        <Emblem rank={medal.rank} cy={cy} scale={scale} />
      </g>
      <g className="rw-ink">
        <Emblem rank={medal.rank} cy={cy} scale={scale} />
      </g>
      <g clipPath={url('k')}>
        <path
          d={small ? 'M17 40a32 32 0 0 1 27-25' : 'M27.5 43a21.5 21.5 0 0 1 18.5-16'}
          fill="none"
          stroke="#fff"
          strokeOpacity={small ? 0.6 : 0.7}
          strokeWidth={small ? 4 : 2.2}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
