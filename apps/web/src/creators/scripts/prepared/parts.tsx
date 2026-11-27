import type { CreatorId, PreparedScriptMoment } from '@impera/contracts';
import { useState, type JSX } from 'react';

import type { EditorMedia } from './media';

import { mediaKindLine } from '@/creators/vault/model';
import { Preview, Sharp } from '@/creators/vault/parts';

/*
 * The small pieces of the editor: a media's tile (the platform's blur, the sharp small picture on a gesture), the
 * moment's choice, the icons.
 */

/** A media of a branch: its blurred preview, its kind, and a flag when a script cannot sell it as it is. */
export function MediaTile({
  creatorId,
  item,
  mediaRef,
  flagged,
}: {
  creatorId: CreatorId;
  /** `null`: her vault no longer lists it. */
  item: EditorMedia | null;
  mediaRef: string;
  flagged: boolean;
}): JSX.Element {
  const [sharp, setSharp] = useState(false);
  const title = item === null ? 'N’est plus dans son coffre' : (item.excerpt ?? 'Pas encore décrit');
  return (
    <span className="se-tile" title={title} data-sharp={sharp ? '' : undefined} data-ref={mediaRef}>
      <span className="se-tile__img" aria-hidden="true">
        <Preview hash={item?.media.blurhash ?? null} />
        {sharp && item !== null ? <Sharp creatorId={creatorId} media={item.media} /> : null}
      </span>
      <span className="se-tile__kind">{item === null ? 'Absent' : mediaKindLine(item.media)}</span>
      {flagged ? (
        <span className="se-tile__flag" aria-label={title}>
          !
        </span>
      ) : null}
      {item === null || item.media.kind === 'audio' ? null : (
        <button
          type="button"
          className="se-sharp"
          onClick={(event) => {
            event.stopPropagation();
            setSharp((was) => !was);
          }}
        >
          {sharp ? 'Flouter' : 'Voir net'}
        </button>
      )}
    </span>
  );
}

export function SunIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </svg>
  );
}

export function MoonIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6z" />
    </svg>
  );
}

export function ChevronIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/**
 * « Se joue le jour / la nuit / jour et nuit »: a setting of the script chosen by hand, never read from its media, never
 * the screen's appearance.
 */
export function MomentChoice({
  value,
  onChange,
}: {
  value: PreparedScriptMoment;
  onChange: (moment: PreparedScriptMoment) => void;
}): JSX.Element {
  const options: readonly [PreparedScriptMoment, string, JSX.Element][] = [
    ['day', 'le jour', <SunIcon key="sun" />],
    ['night', 'la nuit', <MoonIcon key="moon" />],
    [
      'both',
      'jour et nuit',
      <span key="both" className="se-moment__both" aria-hidden="true">
        <SunIcon />
        <MoonIcon />
      </span>,
    ],
  ];
  return (
    <div className="se-moment" role="radiogroup" aria-label="Moment où il se joue">
      <span className="se-moment__label">Se joue</span>
      {options.map(([moment, label, icon]) => (
        <button
          key={moment}
          type="button"
          role="radio"
          className="se-moment__opt"
          aria-checked={value === moment}
          onClick={() => {
            onChange(moment);
          }}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * « Retirer l’étape », « Retirer la branche »: a grey button, red only in the inline confirmation it opens (red is kept
 * for what is urgent).
 */
export function RemoveButton({ label, onConfirm }: { label: string; onConfirm: () => void }): JSX.Element {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        type="button"
        className="nv-btn nv-btn--plain nv-btn--sm se-flush"
        onClick={() => {
          setAsking(true);
        }}
      >
        {label}
      </button>
    );
  return (
    <span className="se-confirm" role="group" aria-label={label}>
      <button
        type="button"
        className="nv-btn nv-btn--soft nv-btn--sm nv-btn--destructive"
        onClick={onConfirm}
      >
        {label}, sûr
      </button>
      <button
        type="button"
        className="nv-btn nv-btn--plain nv-btn--sm"
        onClick={() => {
          setAsking(false);
        }}
      >
        Annuler
      </button>
    </span>
  );
}
