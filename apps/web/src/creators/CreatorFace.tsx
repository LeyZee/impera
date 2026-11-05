import { useState, type JSX } from 'react';

import { cn, initialOf } from '@/lib/utils';
import './face.css';

/** What a face needs of her: her id may come unbranded from a screen's own answer (the Dashboard's). */
interface Face {
  readonly id: string;
  readonly displayName: string;
  readonly hasAvatar?: boolean | undefined;
}

/** Her photo, served from our own origin (CRM-07 a2b): the CRM's CSP takes no other. */
export const creatorAvatarUrl = (creatorId: string): string =>
  `/v1/creators/${encodeURIComponent(creatorId)}/avatar`;

/**
 * Her face where her initial stood (CRM-07 b2, ADR 0069 § 3): the photo copied at her import when there is one, her
 * initial otherwise, and her initial again if the photo does not load (removed since, the server silent). Decoration:
 * her name is always written beside it.
 */
export function CreatorFace({ creator, className }: { creator: Face; className: string }): JSX.Element {
  // Which photo failed, so that another creator's is tried again.
  const [failed, setFailed] = useState<string | null>(null);
  const photo = creator.hasAvatar === true && failed !== creator.id;
  return (
    <span className={cn(className, photo && 'cr-face--photo')} aria-hidden="true">
      {photo ? (
        <img
          src={creatorAvatarUrl(creator.id)}
          alt=""
          decoding="async"
          onError={() => {
            setFailed(creator.id);
          }}
        />
      ) : (
        initialOf(creator.displayName)
      )}
    </span>
  );
}

/**
 * Her face in a chip, before her name: her photo, or her initial in a disc of the same size when she has none or it
 * does not load, so that a row of chips keeps one rhythm (captures de #563).
 */
export function ChipFace({ creator }: { creator: Face }): JSX.Element {
  const [failed, setFailed] = useState<string | null>(null);
  if (creator.hasAvatar !== true || failed === creator.id) {
    return (
      <span className="cr-chip-face cr-chip-face--initial" aria-hidden="true">
        {initialOf(creator.displayName)}
      </span>
    );
  }
  return (
    <img
      className="cr-chip-face"
      src={creatorAvatarUrl(creator.id)}
      alt=""
      aria-hidden="true"
      decoding="async"
      onError={() => {
        setFailed(creator.id);
      }}
    />
  );
}
