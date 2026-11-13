import { useId, type JSX } from 'react';

import './rewards.css';

/*
 * A trophy's badge (CHF-01, ADR 0104 § 15 and its note « médailles »): a shield of dark glass rimmed in gold, with
 * the one symbol that says what was done. Every symbol is literal (a euro for a sale, a calendar for a record, a
 * clock for « à l'heure », a flame for a streak) and sits on the shield's axis: its main shape is centred, a small
 * round mark hangs in its corner. Under 40 px the shield fills its box and the symbol loses its number: the
 * trophy's name is always written beside it.
 */

/** The closed list of ADR 0104 § 15, but the tier reached, which wears its medal. */
export type TrophyKind =
  | 'first_sale'
  | 'day_record'
  | 'fortnight_record'
  | 'fortnight_on_time'
  | 'streak_5'
  | 'streak_10'
  | 'streak_25'
  | 'ten_ppv_shift';

export const TROPHY_NAMES: Readonly<Record<TrophyKind, string>> = {
  first_sale: 'Première vente',
  day_record: 'Record du jour',
  fortnight_record: 'Record de quinzaine',
  fortnight_on_time: 'Quinzaine à l’heure',
  streak_5: 'Série de 5',
  streak_10: 'Série de 10',
  streak_25: 'Série de 25',
  ten_ppv_shift: 'Dix PPV dans un shift',
};

const SHIELD = 'M48 6l32 9.5v25.5c0 20-12.5 35.5-32 46.5C28.5 76.5 16 61 16 41V15.5z';
const SHIELD_IN = 'M48 11.5l27 8v21.5c0 17.3-10.6 30.8-27 40.5-16.4-9.7-27-23.2-27-40.5V19.5z';
const HAIRLINE = 'M48 15.5l23.5 7v19c0 15.3-9.3 27.3-23.5 36-14.2-8.7-23.5-20.7-23.5-36v-19z';

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

/** What a symbol is drawn with: its light (the gold, or the grey of « pas encore ») and the dark it is cut with. */
interface Inks {
  readonly light: string;
  readonly dark: string;
  /** Under 40 px: the main shape alone. */
  readonly plain: boolean;
}

function Digits({
  x,
  y,
  size,
  fill,
  children,
}: {
  x: number;
  y: number;
  size: number;
  fill: string;
  children: string;
}) {
  return (
    <text className="rw-digits" x={x} y={y} textAnchor="middle" fontSize={size} fill={fill}>
      {children}
    </text>
  );
}

/** The round mark in a symbol's corner. */
function Corner({ cx, cy, dark, children }: { cx: number; cy: number; dark: string; children: JSX.Element }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={10.5} fill={dark} />
      {children}
    </>
  );
}

function Coin({ light, dark, plain }: Inks): JSX.Element {
  return (
    <>
      <circle cx={47} cy={46} r={21} fill={light} />
      <circle cx={47} cy={46} r={16.8} fill="none" stroke={dark} strokeWidth={1.3} opacity={0.4} />
      <Digits x={46.4} y={54.6} size={25} fill={dark}>
        €
      </Digits>
      {plain ? null : (
        <Corner cx={62.5} cy={30.5} dark={dark}>
          <Digits x={62.5} y={35.7} size={15} fill={light}>
            1
          </Digits>
        </Corner>
      )}
    </>
  );
}

function Calendar({ light, dark, plain, days }: Inks & { days: string }): JSX.Element {
  return (
    <>
      <rect x={29} y={28} width={38} height={36} rx={6.5} fill={light} />
      <rect x={37} y={23} width={4} height={10} rx={2} fill={light} />
      <rect x={plain ? 55 : 47} y={23} width={4} height={10} rx={2} fill={light} />
      <rect x={29} y={37.5} width={38} height={2.2} fill={dark} opacity={0.4} />
      {plain ? (
        <path d={starPath(48, 52, 9)} fill={dark} />
      ) : (
        <>
          <Digits x={47} y={59.5} size={19} fill={dark}>
            {days}
          </Digits>
          <Corner cx={61} cy={32} dark={dark}>
            <path d={starPath(61, 32, 6.8)} fill={light} />
          </Corner>
        </>
      )}
    </>
  );
}

function Clock({ light, dark, plain }: Inks): JSX.Element {
  return (
    <>
      <circle cx={47} cy={46} r={21} fill={light} />
      <path
        d="M47 34v12l8 5"
        fill="none"
        stroke={dark}
        strokeWidth={plain ? 5 : 3.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {plain ? null : (
        <>
          {(
            [
              [47, 29.5],
              [47, 62.5],
              [30.5, 46],
              [63.5, 46],
            ] as const
          ).map(([x, y]) => (
            <circle key={`${String(x)}-${String(y)}`} cx={x} cy={y} r={1.5} fill={dark} opacity={0.5} />
          ))}
          <Corner cx={62.5} cy={30.5} dark={dark}>
            <path
              d="M57.5 30.5l3.6 3.6 6.8-7.4"
              fill="none"
              stroke={light}
              strokeWidth={2.9}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Corner>
        </>
      )}
    </>
  );
}

function Flame({ light, dark, plain, count }: Inks & { count: string }): JSX.Element {
  return (
    <>
      <path
        d="M49 20c2.5 10.5 17 15 17 29.5C66 59.2 58 66 48 66s-18-6.8-18-16.5c0-6 3-10 5.500-13 .8 4 2.500 6.500 5 7.500-1.500-9 1.500-18 8.500-24z"
        fill={light}
      />
      {plain ? null : (
        <Digits x={48} y={60} size={count.length > 1 ? 16.5 : 19} fill={dark}>
          {count}
        </Digits>
      )}
    </>
  );
}

function Media({ light, dark }: Inks): JSX.Element {
  return (
    <>
      <rect x={27} y={34} width={33} height={27} rx={6} fill={light} />
      <path d="M39 41.5v12l10.5-6z" fill={dark} />
      <circle cx={55.5} cy={37.5} r={11.5} fill={dark} />
      <path
        d="M51.3 35.5v-2.8a4.3 4.3 0 0 1 8.3-1.5"
        fill="none"
        stroke={light}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <rect x={49} y={35} width={13} height={9.5} rx={2.4} fill={light} />
    </>
  );
}

/** A symbol and the box of its main shape, which `Fitted` centres on the shield's axis. */
const SYMBOLS: Readonly<
  Record<
    TrophyKind,
    { readonly box: readonly [number, number, number, number]; readonly draw: (inks: Inks) => JSX.Element }
  >
> = {
  first_sale: { box: [26, 25, 68, 67], draw: (inks) => <Coin {...inks} /> },
  day_record: { box: [29, 23, 67, 64], draw: (inks) => <Calendar {...inks} days="1" /> },
  fortnight_record: { box: [29, 23, 67, 64], draw: (inks) => <Calendar {...inks} days="15" /> },
  fortnight_on_time: { box: [26, 25, 68, 67], draw: (inks) => <Clock {...inks} /> },
  streak_5: { box: [30, 20, 66, 66], draw: (inks) => <Flame {...inks} count="5" /> },
  streak_10: { box: [30, 20, 66, 66], draw: (inks) => <Flame {...inks} count="10" /> },
  streak_25: { box: [30, 20, 66, 66], draw: (inks) => <Flame {...inks} count="25" /> },
  ten_ppv_shift: { box: [25, 27, 62, 64], draw: (inks) => <Media {...inks} /> },
};

/** The symbol scaled into the shield's safe field and centred on its main shape: nothing reaches the gold hairline. */
function Fitted({ kind, inks }: { kind: TrophyKind; inks: Inks }): JSX.Element {
  const symbol = SYMBOLS[kind];
  const [x0, y0, x1, y1] = symbol.box;
  const scale = round((inks.plain ? 40 : 32) / Math.max(x1 - x0, y1 - y0));
  return (
    <g
      className="rw-symbol"
      transform={`translate(48 ${inks.plain ? '44.5' : '45'}) scale(${String(scale)}) translate(${String(round(-(x0 + x1) / 2))} ${String(round(-(y0 + y1) / 2))})`}
    >
      {symbol.draw(inks)}
    </g>
  );
}

export function TrophyBadge({
  kind,
  earned = true,
  size,
  glow = false,
  className,
}: {
  kind: TrophyKind;
  earned?: boolean;
  /** Its side in pixels: under 40 the shield fills its box and the symbol is its main shape alone. */
  size: number;
  /** A neon halo around it: for a badge shown on its own, never in a list (and never in Day, `rewards.css`). */
  glow?: boolean;
  className?: string;
}): JSX.Element {
  const id = useId();
  const small = size < 40;
  const frame = small ? 'translate(48 48) scale(1.14) translate(-48 -47)' : undefined;
  const url = (name: string): string => `url(#${id}${name})`;
  const common = {
    className: ['rw-trophy', className].filter(Boolean).join(' '),
    'data-earned': earned,
    viewBox: '0 0 96 96',
    width: size,
    height: size,
    role: 'img',
    'aria-label': `Trophée « ${TROPHY_NAMES[kind]} »${earned ? '' : ', pas encore gagné'}`,
  } as const;
  if (!earned)
    return (
      <svg {...common}>
        <g transform={frame}>
          <path d={SHIELD} fill="currentColor" opacity={0.1} />
          <path
            d={SHIELD}
            fill="none"
            stroke="currentColor"
            strokeWidth={small ? 5 : 2.4}
            strokeLinejoin="round"
            opacity={0.5}
          />
          {small ? null : (
            <g opacity={0.42}>
              <Fitted kind={kind} inks={{ light: 'currentColor', dark: 'var(--rw-cut)', plain: false }} />
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
          <path d={SHIELD_IN} />
        </clipPath>
      </defs>
      {glow && !small ? <circle className="rw-glow" cx={48} cy={48} r={48} fill={url('g')} /> : null}
      <g transform={frame}>
        <path d={SHIELD} fill={url('r')} />
        <path d={SHIELD_IN} fill={url('p')} />
        <path d={SHIELD_IN} fill={url('n')} />
        {small ? null : <path className="rw-mid" d={HAIRLINE} strokeWidth={0.8} opacity={0.5} />}
        <g clipPath={url('k')}>
          <path d="M16 8h64v22c-18 7-46 7-64 0z" fill="#fff" opacity={0.1} />
        </g>
        <Fitted kind={kind} inks={{ light: url('y'), dark: 'var(--rw-glass-2)', plain: small }} />
      </g>
    </svg>
  );
}
