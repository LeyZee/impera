import { useId, type JSX, type ReactNode } from 'react';

import './art.css';

/*
 * The pictures of an empty screen (Charles, 20/11: « des SVG comme ça pour chaque fonctionnalité »), in the hand of the
 * vault's open chest: the theme's ink for the lines, its colours mixed for the fills, a light behind, a few glints, a
 * slow float. One picture per subject, on a screen that is empty as a whole, never inside a card that holds other things.
 */

/** A four-pointed spark, the glint of something precious. */
const spark = (x: number, y: number, size: number): string => {
  const n = (factor: number): string => String(Math.round(size * factor * 100) / 100);
  const s = n(1);
  return `M${String(x)} ${String(y - size)}c${n(0.18)} ${n(0.62)} ${n(0.2)} ${n(0.8)} ${s} ${s}c-${n(0.8)} ${n(0.2)}-${n(0.82)} ${n(0.38)}-${s} ${s}c-${n(0.18)}-${n(0.62)}-${n(0.2)}-${n(0.8)}-${s}-${s}c${n(0.8)}-${n(0.2)} ${n(0.82)}-${n(0.38)} ${s}-${s}Z`;
};

/** A heart, its tip at the origin. */
const HEART =
  'M0 0C-7-5-11-10-11-14.5C-11-18.5-8-21-5-21C-2.5-21-.8-19.6 0-17.6C.8-19.6 2.5-21 5-21C8-21 11-18.5 11-14.5C11-10 7-5 0 0Z';

interface Paints {
  /** The front of the subject: a little of the neon over the raised surface, top to bottom. */
  readonly body: string;
  /** What glows: the neon, towards the agent's violet. */
  readonly hot: string;
  /** A screen, an opening: the neon sinking into the dark. */
  readonly deep: string;
}

/** The frame every picture shares: its ground, the light behind, three glints, and the gradients of the theme. */
function Art({
  sparks,
  children,
}: {
  /** Where the three glints sit: `[x, y, size]` each. */
  sparks: readonly [readonly number[], readonly number[], readonly number[]];
  children: (paints: Paints) => ReactNode;
}): JSX.Element {
  // In a `url(#…)`: React's ids carry colons.
  const id = useId().replaceAll(':', '');
  const tones = ['a', 'b', 'c'] as const;
  return (
    <svg className="nv-art" viewBox="0 0 160 132" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-light`} cx="0.5" cy="0.55" r="0.5">
          <stop className="nv-art__stop-light" offset="0" />
          <stop className="nv-art__stop-clear" offset="1" />
        </radialGradient>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop className="nv-art__stop-body-top" offset="0" />
          <stop className="nv-art__stop-body-bottom" offset="1" />
        </linearGradient>
        <linearGradient id={`${id}-hot`} x1="0" y1="0" x2="1" y2="1">
          <stop className="nv-art__stop-hot-top" offset="0" />
          <stop className="nv-art__stop-hot-bottom" offset="1" />
        </linearGradient>
        <linearGradient id={`${id}-deep`} x1="0" y1="0" x2="0" y2="1">
          <stop className="nv-art__stop-deep-top" offset="0" />
          <stop className="nv-art__stop-deep-bottom" offset="1" />
        </linearGradient>
      </defs>
      <ellipse className="nv-art__ground" cx="80" cy="122" rx="54" ry="5" />
      <ellipse className="nv-art__light" cx="80" cy="64" rx="70" ry="56" fill={`url(#${id}-light)`} />
      {children({ body: `url(#${id}-body)`, hot: `url(#${id}-hot)`, deep: `url(#${id}-deep)` })}
      {sparks.map(([x = 0, y = 0, size = 3], index) => (
        <path
          key={tones[index]}
          className={`nv-art__spark nv-art__spark--${tones[index] ?? 'a'}`}
          d={spark(x, y, size)}
        />
      ))}
    </svg>
  );
}

/** No conversation open: two bubbles, hers glowing, a heart above. */
export function ChatArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [146, 60, 4.2],
        [18, 30, 3.4],
        [30, 104, 3],
      ]}
    >
      {({ body, hot }) => (
        <>
          <g className="nv-art__float nv-art__float--2">
            <path
              className="nv-art__line"
              fill={body}
              d="M38 26H86Q102 26 102 42V62Q102 78 86 78H52L36 91L38 78Q22 78 22 62V42Q22 26 38 26Z"
            />
            <path className="nv-art__rule nv-art__rule--ink" d="M38 44H86M38 56H70" />
          </g>
          <g className="nv-art__float">
            <path
              className="nv-art__line"
              fill={hot}
              d="M78 56H122Q138 56 138 72V88Q138 104 122 104L125 116L110 104H78Q62 104 62 88V72Q62 56 78 56Z"
            />
            <circle className="nv-art__white" cx="86" cy="80" r="4.2" />
            <circle className="nv-art__white" cx="100" cy="80" r="4.2" />
            <circle className="nv-art__white" cx="114" cy="80" r="4.2" />
          </g>
          <g className="nv-art__float nv-art__float--3" transform="translate(124 42)">
            <path className="nv-art__line nv-art__warm" d={HEART} transform="rotate(14) scale(0.9)" />
          </g>
        </>
      )}
    </Art>
  );
}

const CELLS = [0, 1, 2, 3].flatMap((column) => [0, 1, 2].map((row) => ({ column, row })));

/** No shift this week: a calendar, one day lit, the moon of a night shift. */
export function PlanningArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [20, 52, 4],
        [146, 84, 3.4],
        [112, 12, 3],
      ]}
    >
      {({ body, hot }) => (
        <>
          <g className="nv-art__float">
            <rect className="nv-art__line" fill={body} x="32" y="30" width="96" height="84" rx="13" />
            <path className="nv-art__line" fill={hot} d="M32 43Q32 30 45 30H115Q128 30 128 43V54H32Z" />
            <rect className="nv-art__line nv-art__white" x="53" y="21" width="9" height="18" rx="4.5" />
            <rect className="nv-art__line nv-art__white" x="98" y="21" width="9" height="18" rx="4.5" />
            {CELLS.map(({ column, row }) => (
              <rect
                key={`${String(column)}-${String(row)}`}
                className={column === 2 && row === 1 ? 'nv-art__line nv-art__neon' : 'nv-art__cell'}
                x={43 + column * 19.5}
                y={63 + row * 15.5}
                width="15"
                height="11"
                rx="3.5"
              />
            ))}
          </g>
          <g className="nv-art__float nv-art__float--3" transform="translate(5 -8)">
            <path className="nv-art__line nv-art__warm" d="M139 20A15 15 0 1 0 150 46A12 12 0 0 1 139 20Z" />
          </g>
        </>
      )}
    </Art>
  );
}

/** No script yet: a scroll unrolled, its steps down the page, the quill that writes it. */
export function ScriptArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [22, 40, 4],
        [144, 26, 3.4],
        [140, 104, 3],
      ]}
    >
      {({ body, hot }) => (
        <>
          <g className="nv-art__float nv-art__float--2">
            <rect className="nv-art__line nv-art__paper" x="42" y="26" width="76" height="84" />
            <rect className="nv-art__line" fill={body} x="33" y="18" width="94" height="15" rx="7.5" />
            <rect className="nv-art__line" fill={body} x="33" y="103" width="94" height="15" rx="7.5" />
            <path className="nv-art__thread" d="M56 48V86" />
            <circle className="nv-art__line nv-art__neon" cx="56" cy="48" r="5" />
            <circle className="nv-art__line nv-art__violet" cx="56" cy="67" r="5" />
            <circle className="nv-art__line nv-art__warm" cx="56" cy="86" r="5" />
            <path className="nv-art__rule" d="M68 48H104M68 67H96M68 86H100" />
          </g>
          <g className="nv-art__float" transform="translate(96 78)">
            <path className="nv-art__line" fill={hot} d="M2 6C8-16 24-30 46-34C44-14 30 2 8 10Z" />
            <path className="nv-art__quill" d="M-6 16L8 2L34-24" />
          </g>
        </>
      )}
    </Art>
  );
}

/** No invoice yet: a receipt, its total in neon, coins beside it. */
export function InvoiceArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [24, 34, 4],
        [142, 28, 3.2],
        [26, 100, 3],
      ]}
    >
      {({ hot }) => (
        <>
          <g className="nv-art__float nv-art__float--2">
            <path
              className="nv-art__line nv-art__paper"
              d="M44 22Q44 16 50 16H102Q108 16 108 22V108L100 102L92 108L84 102L76 108L68 102L60 108L52 102L44 108Z"
            />
            <circle className="nv-art__line" fill={hot} cx="76" cy="34" r="8" />
            <path className="nv-art__rule" d="M56 54H96M56 65H88M56 76H92" />
            <path className="nv-art__total" d="M56 90H96" />
          </g>
          <g className="nv-art__float">
            {[112, 104, 96].map((y) => (
              <g key={y}>
                <path
                  className="nv-art__line nv-art__warm"
                  d={`M96 ${String(y)}V${String(y + 7)}A22 7.5 0 0 0 140 ${String(y + 7)}V${String(y)}Z`}
                />
                <ellipse className="nv-art__line nv-art__warm-light" cx="118" cy={y} rx="22" ry="7.5" />
              </g>
            ))}
            <ellipse className="nv-art__coin-mark" cx="118" cy="96" rx="12" ry="3.6" />
          </g>
          <g className="nv-art__float nv-art__float--3">
            <circle className="nv-art__line nv-art__warm-light" cx="132" cy="56" r="11" />
            <circle className="nv-art__coin-mark" cx="132" cy="56" r="6.4" />
          </g>
        </>
      )}
    </Art>
  );
}

/** No link yet: two links of a chain, one of them glowing, a heart it will bring. */
export function LinkArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [136, 96, 4],
        [24, 44, 3.4],
        [118, 16, 3],
      ]}
    >
      {() => (
        <>
          <g className="nv-art__float" transform="rotate(-24 80 70)">
            <rect className="nv-art__ring-edge" x="72" y="50" width="64" height="40" rx="20" />
            <rect className="nv-art__ring nv-art__ring--soft" x="72" y="50" width="64" height="40" rx="20" />
            <rect className="nv-art__ring-edge" x="24" y="50" width="64" height="40" rx="20" />
            <rect className="nv-art__ring nv-art__ring--hot" x="24" y="50" width="64" height="40" rx="20" />
            {/* The second link passes over the first one's lower edge: they hold each other. */}
            <path className="nv-art__ring-edge nv-art__ring-edge--cut" d="M72 76Q72 90 92 90" />
            <path className="nv-art__ring nv-art__ring--soft nv-art__ring--cut" d="M72 74Q72 90 94 90" />
          </g>
          <g className="nv-art__float nv-art__float--3" transform="translate(40 36)">
            <path className="nv-art__line nv-art__warm" d={HEART} transform="rotate(-12) scale(0.8)" />
          </g>
        </>
      )}
    </Art>
  );
}

/** No fan yet: her phone, lit, the first hearts rising from it. */
export function FansArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [26, 74, 4],
        [140, 88, 3.4],
        [38, 20, 3],
      ]}
    >
      {({ body, deep }) => (
        <>
          <g className="nv-art__float nv-art__float--2">
            <rect className="nv-art__line" fill={body} x="54" y="26" width="52" height="92" rx="12" />
            <rect className="nv-art__screen" fill={deep} x="60" y="34" width="40" height="72" rx="6" />
            <rect className="nv-art__notch" x="72" y="30" width="16" height="3" rx="1.5" />
            <path
              className="nv-art__white"
              d="M68 76H88Q92 76 92 80V88Q92 92 88 92H76L70 97V92H68Q64 92 64 88V80Q64 76 68 76Z"
            />
          </g>
          <g className="nv-art__float" transform="translate(112 54)">
            <path className="nv-art__line nv-art__neon" d={HEART} transform="rotate(16) scale(1.15)" />
          </g>
          <g className="nv-art__float nv-art__float--3" transform="translate(46 46)">
            <path className="nv-art__line nv-art__warm" d={HEART} transform="rotate(-18) scale(0.85)" />
          </g>
          <g className="nv-art__float nv-art__float--2" transform="translate(84 22)">
            <path className="nv-art__line nv-art__violet" d={HEART} transform="rotate(6) scale(0.62)" />
          </g>
        </>
      )}
    </Art>
  );
}

/** Nobody in the team yet: three of them, the one in the middle wearing the headset of a shift. */
export function TeamArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [22, 34, 4],
        [142, 30, 3.4],
        [148, 96, 3],
      ]}
    >
      {({ body, hot }) => (
        <>
          <g className="nv-art__float nv-art__float--2">
            <path className="nv-art__line" fill={body} d="M20 114Q20 78 44 78Q68 78 68 114Z" />
            <circle className="nv-art__line nv-art__violet" cx="44" cy="60" r="12" />
          </g>
          <g className="nv-art__float nv-art__float--3">
            <path className="nv-art__line" fill={body} d="M92 114Q92 78 116 78Q140 78 140 114Z" />
            <circle className="nv-art__line nv-art__warm-light" cx="116" cy="60" r="12" />
          </g>
          <g className="nv-art__float">
            <path className="nv-art__line" fill={hot} d="M50 116Q50 72 80 72Q110 72 110 116Z" />
            <circle className="nv-art__line nv-art__white" cx="80" cy="48" r="15" />
            <path className="nv-art__quill" d="M63 48A17 17 0 0 1 97 48" />
            <rect className="nv-art__line nv-art__warm" x="58" y="43" width="8" height="14" rx="4" />
            <rect className="nv-art__line nv-art__warm" x="94" y="43" width="8" height="14" rx="4" />
          </g>
        </>
      )}
    </Art>
  );
}

/** An empty file: a folder half open, the first sheet coming out of it. */
export function FolderArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [22, 48, 4],
        [144, 34, 3.4],
        [138, 110, 3],
      ]}
    >
      {({ body, hot }) => (
        <>
          <g className="nv-art__float nv-art__float--2">
            <path
              className="nv-art__line"
              fill={body}
              d="M30 46Q30 36 40 36H64L74 46H120Q130 46 130 56V102Q130 112 120 112H40Q30 112 30 102Z"
            />
          </g>
          <g className="nv-art__float nv-art__float--3">
            <rect className="nv-art__line nv-art__paper" x="46" y="24" width="68" height="70" rx="5" />
            <path className="nv-art__rule" d="M58 40H102M58 52H92" />
          </g>
          <g className="nv-art__float nv-art__float--2">
            <path
              className="nv-art__line"
              fill={hot}
              d="M24 70Q23 62 31 62H129Q137 62 136 70L131 104Q130 112 121 112H39Q30 112 29 104Z"
            />
            <circle className="nv-art__white" cx="64" cy="87" r="7" />
            <path className="nv-art__rule" d="M80 82H112M80 93H102" />
          </g>
        </>
      )}
    </Art>
  );
}

/** A page that does not exist: a compass, its needle looking for the way. */
export function CompassArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [24, 40, 4],
        [142, 100, 3.4],
        [134, 22, 3],
      ]}
    >
      {({ body }) => (
        <g className="nv-art__float">
          <circle className="nv-art__line nv-art__warm" cx="80" cy="20" r="7" />
          <circle className="nv-art__line" fill={body} cx="80" cy="70" r="44" />
          <circle className="nv-art__line nv-art__paper" cx="80" cy="70" r="33" />
          <path className="nv-art__rule" d="M80 42V46M80 94V98M52 70H56M104 70H108" />
          <g transform="rotate(34 80 70)">
            <path className="nv-art__line nv-art__neon" d="M80 44L90 70H70Z" />
            <path className="nv-art__line nv-art__white" d="M70 70H90L80 96Z" />
          </g>
          <circle className="nv-art__line nv-art__warm-light" cx="80" cy="70" r="4.5" />
        </g>
      )}
    </Art>
  );
}

/** No goal yet: a target, the arrow already in its heart. */
export function TargetArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [22, 30, 4],
        [146, 70, 3.4],
        [28, 108, 3],
      ]}
    >
      {({ body, hot }) => (
        <>
          <g className="nv-art__float nv-art__float--2">
            <circle className="nv-art__line" fill={body} cx="74" cy="72" r="44" />
            <circle className="nv-art__line nv-art__paper" cx="74" cy="72" r="31" />
            <circle className="nv-art__line" fill={hot} cx="74" cy="72" r="18" />
            <circle className="nv-art__white" cx="74" cy="72" r="6" />
          </g>
          <g className="nv-art__float">
            <path className="nv-art__shaft" d="M76 70L128 22" />
            <path className="nv-art__line nv-art__warm" d="M120 30L134 8L140 22L148 28L128 38Z" />
          </g>
        </>
      )}
    </Art>
  );
}

/** Nothing dropped yet: her camera, the lens lit, a heart for what it will bring. */
export function CameraArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [20, 60, 4],
        [144, 104, 3.4],
        [36, 22, 3],
      ]}
    >
      {({ body, hot, deep }) => (
        <>
          <g className="nv-art__float nv-art__float--2">
            <path className="nv-art__line" fill={body} d="M56 46L63 32H97L104 46Z" />
            <rect className="nv-art__line" fill={body} x="28" y="44" width="104" height="68" rx="14" />
            <rect className="nv-art__line nv-art__warm" x="40" y="54" width="16" height="9" rx="4.5" />
            <circle className="nv-art__line" fill={hot} cx="80" cy="79" r="24" />
            <circle className="nv-art__screen" fill={deep} cx="80" cy="79" r="14" />
            <circle className="nv-art__white" cx="74" cy="73" r="4" />
          </g>
          <g className="nv-art__float nv-art__float--3" transform="translate(128 36)">
            <path className="nv-art__line nv-art__neon" d={HEART} transform="rotate(14) scale(0.9)" />
          </g>
        </>
      )}
    </Art>
  );
}

/** No alert: the bell at rest, nothing ringing. */
export function BellArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [24, 30, 4],
        [140, 26, 3.4],
        [136, 108, 3],
      ]}
    >
      {({ hot }) => (
        <>
          <g className="nv-art__float">
            <circle className="nv-art__line nv-art__warm" cx="80" cy="100" r="9" />
            <path
              className="nv-art__line"
              fill={hot}
              d="M80 24C60 24 50 40 50 60V78L38 96H122L110 78V60C110 40 100 24 80 24Z"
            />
            <circle className="nv-art__line nv-art__white" cx="80" cy="22" r="5.5" />
            <path className="nv-art__rule" d="M62 60Q62 44 74 38" />
          </g>
          <path className="nv-art__rule nv-art__rule--ink" d="M28 52Q22 64 28 76M132 52Q138 64 132 76" />
        </>
      )}
    </Art>
  );
}

/** No creator yet: her crown, waiting for her. */
export function CrownArt(): JSX.Element {
  return (
    <Art
      sparks={[
        [22, 84, 4],
        [144, 80, 3.4],
        [112, 16, 3],
      ]}
    >
      {({ body, hot }) => (
        <g className="nv-art__float">
          <path className="nv-art__line" fill={hot} d="M38 96L28 48L56 68L80 32L104 68L132 48L122 96Z" />
          <rect className="nv-art__line" fill={body} x="34" y="92" width="92" height="18" rx="7" />
          <circle className="nv-art__line nv-art__violet" cx="28" cy="46" r="6.5" />
          <circle className="nv-art__line nv-art__warm-light" cx="80" cy="30" r="7.5" />
          <circle className="nv-art__line nv-art__violet" cx="132" cy="46" r="6.5" />
          <circle className="nv-art__line nv-art__white" cx="80" cy="101" r="4.5" />
          <circle className="nv-art__line nv-art__warm" cx="56" cy="101" r="3.5" />
          <circle className="nv-art__line nv-art__warm" cx="104" cy="101" r="3.5" />
        </g>
      )}
    </Art>
  );
}
