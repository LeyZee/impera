import type { JSX } from 'react';

import { DEFAULT_COLORS, SWATCHES, SWATCH_WORDS, type ColorKind, type Swatch } from './week-colors';
import { NEED_WORDS } from './week-model';

/** The words of each kind she colours, plural, as the palette and her delivery say them. */
export const KIND_WORDS: Readonly<Record<ColorKind, string>> = {
  ...NEED_WORDS,
  instagram: 'Instagram',
  telegram: 'Telegram',
};

/** Her colours, a row a kind: seven swatches, ours marked, one tap to change. Kept on this device. */
export function Palette({
  id,
  kinds,
  colors,
  onPaint,
  onReset,
  onClose,
}: {
  id: string;
  kinds: readonly ColorKind[];
  colors: Readonly<Record<ColorKind, Swatch>>;
  onPaint: (kind: ColorKind, swatch: Swatch) => void;
  onReset: (kinds: readonly ColorKind[]) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      id={id}
      className="wk-palette"
      role="dialog"
      aria-label="Tes couleurs"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="wk-palette__top">
        <p className="wk-palette__lead">Choisis la couleur de chaque type de contenu.</p>
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={onClose}>
          Fermer
        </button>
      </div>
      <ul className="wk-palette__rows">
        {kinds.map((need) => (
          <li key={need} className="wk-palette__row">
            <span className="wk-kind" data-need={need} aria-hidden="true">
              <Icon name={need} />
            </span>
            <span className="wk-palette__word" id={`${id}-${need}`}>
              {KIND_WORDS[need]}
            </span>
            <span className="wk-swatches" role="radiogroup" aria-labelledby={`${id}-${need}`}>
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  role="radio"
                  className="wk-swatch"
                  data-swatch={swatch}
                  aria-checked={colors[need] === swatch}
                  aria-label={SWATCH_WORDS[swatch]}
                  onClick={() => {
                    onPaint(need, swatch);
                  }}
                />
              ))}
            </span>
          </li>
        ))}
      </ul>
      {kinds.every((need) => colors[need] === DEFAULT_COLORS[need]) ? null : (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm wk-palette__reset"
          onClick={() => {
            onReset(kinds);
          }}
        >
          Remettre nos couleurs
        </button>
      )}
    </div>
  );
}

/** The small drawn marks of her week: one per kind of thing she shoots, never a stock icon. */
export function Icon({ name }: { name: ColorKind | 'drop' }): JSX.Element {
  return (
    <svg className="wk-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'feed_shoot' ? (
        <>
          <path
            className="wk-icon__fill"
            d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z"
          />
          <circle cx="12" cy="13" r="3.2" />
        </>
      ) : name === 'feed_video' ? (
        <>
          <rect className="wk-icon__fill" x="3.5" y="6" width="17" height="12" rx="2.5" />
          <path className="wk-icon__ink" d="m10.5 9.5 4 2.5-4 2.5Z" />
        </>
      ) : name === 'reveal_story' ? (
        <>
          <rect className="wk-icon__fill" x="7" y="3" width="10" height="18" rx="2.5" />
          <circle cx="12" cy="10" r="2.2" />
          <path d="M9.5 16.5h5" />
        </>
      ) : name === 'script' ? (
        <>
          <path className="wk-icon__fill" d="M6 4h9l3 3v13H6Z" />
          <path d="M9 11h6M9 14.5h6" />
        </>
      ) : name === 'idea' ? (
        <>
          <path
            className="wk-icon__fill"
            d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.8.6 1.2 1.4 1.2 2.2h4c0-.8.4-1.6 1.2-2.2a5.5 5.5 0 0 0-3.2-10Z"
          />
          <path d="M10 19h4" />
        </>
      ) : name === 'mass_dm' ? (
        <>
          <rect className="wk-icon__fill" x="3.5" y="6" width="17" height="12" rx="2.5" />
          <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
        </>
      ) : name === 'instagram' ? (
        <>
          <rect className="wk-icon__fill" x="4" y="4" width="16" height="16" rx="4.5" />
          <circle cx="12" cy="12" r="3.6" />
          <circle className="wk-icon__ink" cx="16.6" cy="7.4" r="0.9" />
        </>
      ) : name === 'telegram' ? (
        <>
          <path
            className="wk-icon__fill"
            d="M20.5 4.5 3.8 11.2c-.7.3-.6 1.2.1 1.4l4.3 1.3 1.6 4.9c.2.6 1 .8 1.4.3l2.4-2.5 4.2 3.1c.5.4 1.3.1 1.4-.6Z"
          />
          <path d="m8.2 13.9 8.6-6.1" />
        </>
      ) : (
        <>
          <path className="wk-icon__fill" d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
          <path d="M12 15V4.5M7.5 9 12 4.5 16.5 9" />
        </>
      )}
    </svg>
  );
}
