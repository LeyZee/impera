import type { TrophyCaseItem } from '@impera/contracts';
import type { JSX } from 'react';

import { Medal, type Engraving } from './Medal';
import { Corner, Digits, ShieldBadge, starPath, type Inks, type ShieldSymbol } from './TrophyBadge';
import type { Metal } from './metals';
import type { RevealWords } from './reveal-words';

/*
 * The creator's objects (ADR 0107 § 1, § 3 and § 16): her streak medals, the coin and laurel of the chatter's tiers
 * engraved with her days, and her trophies, the same shield with symbols of her own gestures. The drawings are those
 * of planche 3, validated by Charles (« ok captures trophees-creatrice-planche-3 », 13/11). Display only.
 */

export const CREATOR_MEDALS = {
  day_streak_7: { days: 7, metal: 'bronze', stars: 0 },
  day_streak_14: { days: 14, metal: 'argent', stars: 0 },
  day_streak_30: { days: 30, metal: 'or', stars: 0 },
  day_streak_50: { days: 50, metal: 'or', stars: 1 },
  day_streak_100: { days: 100, metal: 'or', stars: 2 },
} as const satisfies Readonly<
  Record<string, { readonly days: number; readonly metal: Metal; readonly stars: Engraving['stars'] }>
>;
export type CreatorMedalKind = keyof typeof CREATOR_MEDALS;

export const CREATOR_TROPHY_NAMES = {
  first_drop: 'Premier dépôt',
  first_on_time_delivery: 'Première livraison à l’heure',
  delivery_streak_5: '5 livraisons à l’heure',
  delivery_streak_10: '10 livraisons à l’heure',
  delivery_streak_25: '25 livraisons à l’heure',
  perfect_day: 'Journée parfaite',
  first_script: 'Premier script tourné',
  full_stock: 'Stock plein',
  hit_content: 'Contenu qui a cartonné',
} as const;
export type CreatorTrophyKind = keyof typeof CREATOR_TROPHY_NAMES;

export const isCreatorMedal = (kind: string): kind is CreatorMedalKind => kind in CREATOR_MEDALS;
export const isCreatorTrophy = (kind: string): kind is CreatorTrophyKind => kind in CREATOR_TROPHY_NAMES;

/** A medal's name, always written beside it under 28 px (§ 1). */
export const medalName = (kind: CreatorMedalKind): string =>
  `Série de ${String(CREATOR_MEDALS[kind].days)} jours`;

/** The name of any of her objects, or `null` for a kind this screen does not know. */
export function creatorObjectName(kind: string): string | null {
  if (isCreatorMedal(kind)) return medalName(kind);
  if (isCreatorTrophy(kind)) return CREATOR_TROPHY_NAMES[kind];
  return null;
}

/** How to earn each of her objects, for the showcase's silhouettes (§ 10). */
export const CREATOR_HOW_TO: Readonly<Record<CreatorMedalKind | CreatorTrophyKind, string>> = {
  day_streak_7: 'Réussis ta routine 7 jours de suite.',
  day_streak_14: 'Réussis ta routine 14 jours de suite.',
  day_streak_30: 'Réussis ta routine 30 jours de suite.',
  day_streak_50: 'Réussis ta routine 50 jours de suite.',
  day_streak_100: 'Réussis ta routine 100 jours de suite.',
  first_drop: 'Dépose ton premier contenu.',
  first_on_time_delivery: 'Livre une demande de l’agence avant la fin de son échéance.',
  delivery_streak_5: 'Livre 5 demandes à l’heure d’affilée.',
  delivery_streak_10: 'Livre 10 demandes à l’heure d’affilée.',
  delivery_streak_25: 'Livre 25 demandes à l’heure d’affilée.',
  perfect_day: 'Fais toutes tes tâches d’une journée, les essentielles et les tiennes.',
  first_script: 'Dépose ton premier script tourné.',
  full_stock: 'Aie toutes tes catégories actives au-dessus de leur seuil le même jour.',
  hit_content: 'Une de tes publications devient « à refaire ».',
};

/** What her reveal says of each (§ 11). */
const REVEAL_TEXTS: Readonly<Record<CreatorMedalKind | CreatorTrophyKind, string>> = {
  day_streak_7: 'Une semaine de routine réussie, sans lâcher.',
  day_streak_14: 'Deux semaines de routine réussie d’affilée.',
  day_streak_30: 'Un mois entier de routine réussie.',
  day_streak_50: '50 jours de routine réussie d’affilée.',
  day_streak_100: '100 jours de routine réussie d’affilée.',
  first_drop: 'Ton premier contenu est arrivé.',
  first_on_time_delivery: 'Ta première demande livrée à l’heure.',
  delivery_streak_5: '5 demandes livrées à l’heure d’affilée.',
  delivery_streak_10: '10 demandes livrées à l’heure d’affilée.',
  delivery_streak_25: '25 demandes livrées à l’heure d’affilée.',
  perfect_day: 'Toutes tes tâches de la journée sont faites.',
  first_script: 'Ton premier script tourné est arrivé.',
  full_stock: 'Toutes tes catégories sont au-dessus de leur seuil.',
  hit_content: 'Une de tes publications a si bien marché qu’on la refait.',
};

const BX = 60.5;
const BY = 32.5;

function Badge({ dark, children }: { dark: string; children: JSX.Element }): JSX.Element {
  return (
    <Corner cx={BX} cy={BY} dark={dark}>
      {children}
    </Corner>
  );
}

function One({ light }: { light: string }): JSX.Element {
  return (
    <Digits x={BX} y={BY + 5.2} size={15} fill={light}>
      1
    </Digits>
  );
}

function Check({ light }: { light: string }): JSX.Element {
  return (
    <path
      d="M55.5 32.5l3.6 3.6 6.8-7.4"
      fill="none"
      stroke={light}
      strokeWidth={2.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

const round = (value: number): number => Number(value.toFixed(2));

function sparkle(cx: number, cy: number, r: number): string {
  const k = round(r * 0.18);
  const p = (x: number, y: number): string => `${String(round(x))} ${String(round(y))}`;
  return [
    `M${p(cx, cy - r)}`,
    `C${p(cx + k, cy - k)} ${p(cx + k, cy - k)} ${p(cx + r, cy)}`,
    `C${p(cx + k, cy + k)} ${p(cx + k, cy + k)} ${p(cx, cy + r)}`,
    `C${p(cx - k, cy + k)} ${p(cx - k, cy + k)} ${p(cx - r, cy)}`,
    `C${p(cx - k, cy - k)} ${p(cx - k, cy - k)} ${p(cx, cy - r)}Z`,
  ].join('');
}

function Camera({ light, dark, plain }: Inks): JSX.Element {
  return (
    <>
      <rect x={25} y={35} width={46} height={28} rx={6.5} fill={light} />
      <path d="M36 35l3.5-6h13l3.5 6z" fill={light} />
      <circle cx={48} cy={49} r={10.5} fill={dark} />
      <circle cx={48} cy={49} r={6.3} fill={light} />
      <circle cx={45.8} cy={46.8} r={2} fill={dark} opacity={0.55} />
      {plain ? null : (
        <>
          <rect x={29} y={39} width={6} height={3} rx={1.5} fill={dark} opacity={0.45} />
          <Badge dark={dark}>
            <One light={light} />
          </Badge>
        </>
      )}
    </>
  );
}

function Parcel({ light, dark, plain }: Inks): JSX.Element {
  return (
    <>
      <path d="M27 37l21-9 21 9v19l-21 9-21-9z" fill={light} />
      <path
        d="M27 37l21 9 21-9M48 46v19"
        fill="none"
        stroke={dark}
        strokeWidth={2.4}
        strokeLinejoin="round"
        opacity={0.55}
      />
      <path
        d="M37.5 32.5l21 9v7"
        fill="none"
        stroke={dark}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
      {plain ? null : (
        <Badge dark={dark}>
          <Check light={light} />
        </Badge>
      )}
    </>
  );
}

function Crate({ light, dark, count }: Inks & { count: string }): JSX.Element {
  const wide = count.length > 1;
  return (
    <>
      <rect x={26} y={27} width={44} height={10} rx={3} fill={light} />
      <rect x={28.5} y={38.5} width={39} height={26.5} rx={3.5} fill={light} />
      <rect x={44} y={27} width={8} height={10} fill={dark} opacity={0.45} />
      <Digits x={48} y={wide ? 59.5 : 61} size={wide ? 19 : 22} fill={dark}>
        {count}
      </Digits>
    </>
  );
}

function PerfectDay({ light, dark, plain }: Inks): JSX.Element {
  return (
    <>
      <rect x={29} y={28} width={38} height={36} rx={6.5} fill={light} />
      <rect x={37} y={23} width={4} height={10} rx={2} fill={light} />
      <rect x={plain ? 55 : 47} y={23} width={4} height={10} rx={2} fill={light} />
      <rect x={29} y={37.5} width={38} height={2.2} fill={dark} opacity={0.4} />
      <path
        d="M38.5 51l6.5 6.5 12-13"
        fill="none"
        stroke={dark}
        strokeWidth={plain ? 5.5 : 4.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {plain ? null : (
        <Badge dark={dark}>
          <path d={starPath(BX, BY, 6.8)} fill={light} />
        </Badge>
      )}
    </>
  );
}

function Clapper({ light, dark, plain }: Inks): JSX.Element {
  return (
    <>
      <rect x={27} y={40} width={42} height={24} rx={4.5} fill={light} />
      <rect x={27} y={40} width={42} height={5} fill={dark} opacity={0.35} />
      <g transform="rotate(-13 28 38)">
        <rect x={27} y={30} width={42} height={8} rx={2.2} fill={light} />
        <path d="M33 30h5l-4 8h-5zM44 30h5l-4 8h-5zM55 30h5l-4 8h-5z" fill={dark} />
      </g>
      <circle cx={28.5} cy={39} r={2.2} fill={dark} />
      {plain ? null : (
        <Badge dark={dark}>
          <One light={light} />
        </Badge>
      )}
    </>
  );
}

function Gauge({ light, dark }: Inks): JSX.Element {
  return (
    <>
      <rect x={24} y={33} width={44} height={26} rx={6} fill={light} />
      <rect x={68} y={40.5} width={4} height={11} rx={1.6} fill={light} />
      {[0, 1, 2, 3].map((index) => (
        <rect key={index} x={28.5 + index * 9.4} y={37.5} width={7.4} height={17} rx={1.8} fill={dark} />
      ))}
    </>
  );
}

function Hit({ light, dark, plain }: Inks): JSX.Element {
  return (
    <>
      <rect x={26} y={29} width={40} height={34} rx={6.5} fill={light} />
      <path d="M30 59l10-12 7 8 5-5 10 9z" fill={dark} opacity={0.85} />
      <circle cx={38} cy={39} r={4} fill={dark} opacity={0.85} />
      {plain ? null : (
        <Badge dark={dark}>
          <path d={sparkle(BX, BY, 7.6)} fill={light} />
        </Badge>
      )}
    </>
  );
}

/** Each symbol and the box of its main shape, the corner badge left out, which the shield centres on its axis. */
const SYMBOLS: Readonly<Record<CreatorTrophyKind, ShieldSymbol>> = {
  first_drop: { box: [25, 29, 71, 63], draw: (inks) => <Camera {...inks} /> },
  first_on_time_delivery: { box: [27, 27, 69, 65], draw: (inks) => <Parcel {...inks} /> },
  delivery_streak_5: { box: [26, 27, 70, 65], draw: (inks) => <Crate {...inks} count="5" /> },
  delivery_streak_10: { box: [26, 27, 70, 65], draw: (inks) => <Crate {...inks} count="10" /> },
  delivery_streak_25: { box: [26, 27, 70, 65], draw: (inks) => <Crate {...inks} count="25" /> },
  perfect_day: { box: [29, 23, 67, 64], draw: (inks) => <PerfectDay {...inks} /> },
  first_script: { box: [27, 26, 69, 64], draw: (inks) => <Clapper {...inks} /> },
  full_stock: { box: [24, 33, 72, 59], draw: (inks) => <Gauge {...inks} /> },
  hit_content: { box: [26, 29, 66, 63], draw: (inks) => <Hit {...inks} /> },
};

/** One of her streak medals. */
export function CreatorMedal({
  kind,
  ...rest
}: {
  kind: CreatorMedalKind;
  earned?: boolean;
  size: number;
  glow?: boolean;
  className?: string;
}): JSX.Element {
  const { days, metal, stars } = CREATOR_MEDALS[kind];
  return (
    <Medal
      medal={{ metal, rank: 1 }}
      engraving={{ text: String(days), stars }}
      label={`Médaille « ${medalName(kind)} »`}
      {...rest}
    />
  );
}

/** One of her trophies. */
export function CreatorTrophy({
  kind,
  ...rest
}: {
  kind: CreatorTrophyKind;
  earned?: boolean;
  size: number;
  glow?: boolean;
  className?: string;
}): JSX.Element {
  return <ShieldBadge symbol={SYMBOLS[kind]} name={CREATOR_TROPHY_NAMES[kind]} {...rest} />;
}

/** Any of her objects drawn at `size`, or `null` for a kind this screen does not know. */
export function CreatorObject({
  kind,
  ...rest
}: {
  kind: string;
  earned?: boolean;
  size: number;
  glow?: boolean;
  className?: string;
}): JSX.Element | null {
  if (isCreatorMedal(kind)) return <CreatorMedal kind={kind} {...rest} />;
  if (isCreatorTrophy(kind)) return <CreatorTrophy kind={kind} {...rest} />;
  return null;
}

const OBJECT_SIZE = 220;

/** Her reveal of `item` (§ 11), or `null` for a kind this screen does not know: it is then marked seen. */
export function creatorRevealWordsOf(item: Pick<TrophyCaseItem, 'kind'>): RevealWords | null {
  const { kind } = item;
  if (isCreatorMedal(kind))
    return {
      object: <CreatorMedal kind={kind} size={OBJECT_SIZE} glow />,
      kicker: 'Médaille de série',
      title: medalName(kind),
      text: REVEAL_TEXTS[kind],
      tone: 'gold',
    };
  if (isCreatorTrophy(kind))
    return {
      object: <CreatorTrophy kind={kind} size={OBJECT_SIZE} glow />,
      kicker: kind.startsWith('delivery_streak_') ? 'Série de livraisons' : 'Trophée gagné',
      title: CREATOR_TROPHY_NAMES[kind],
      text: REVEAL_TEXTS[kind],
      tone: 'neon',
    };
  return null;
}

/** Her highest streak medal earned, for the line beside her day (§ 9), or `null` before her first. */
export function highestMedal(
  items: readonly Pick<TrophyCaseItem, 'kind' | 'earnedAt'>[],
): CreatorMedalKind | null {
  const earned = items.filter((item) => item.earnedAt !== null).map((item) => item.kind);
  const order: readonly CreatorMedalKind[] = [
    'day_streak_100',
    'day_streak_50',
    'day_streak_30',
    'day_streak_14',
    'day_streak_7',
  ];
  return order.find((kind) => earned.includes(kind)) ?? null;
}
