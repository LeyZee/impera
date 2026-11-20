import type { CreatorId } from '@impera/contracts';
import { useMemo, type JSX } from 'react';

import { BUNDLE_TILES, bundleCount, trialTint, type BundleStep, type TurnMedia } from './bundle-step';
import type { ScriptStepAnswer } from './client';
import { money } from './logic';

import { useVault } from '@/creators/vault/api';
import { Preview, Sharp } from '@/creators/vault/parts';
import { useMediaBlur } from '@/shell/media-blur';

const STEP_STATE_LABELS = {
  bought: 'Acheté, en fictif',
  refused: 'Refusé',
  closed: 'Sans réponse : le script s’est arrêté',
} as const;

/**
 * A step of a script as the fan gets it on Reveal (ADR 0103 § 15-17): one message, the step's words and its whole
 * bundle, the teaser open, the rest blurred and locked with its price until he buys. Her own media are drawn from her
 * vault, blurred, sharp only once bought and the media blur off (ADR 0030 § 4, ADR 0138); a trial media is a generated
 * tint, never an image. « Payer (fictif) » and « Refuser » act on the paid step waiting; nothing reaches Reveal.
 */
export function Bundle({
  media,
  step,
  text,
  creatorId,
  busy,
  salesFrozen,
  onScriptStep,
}: {
  media: readonly TurnMedia[];
  step: BundleStep;
  /** The step's own words on the platform; empty when it has none. */
  text: string;
  /** Her creator, when one of her versions is played: her media are drawn from her vault. */
  creatorId: CreatorId | null;
  busy: boolean;
  salesFrozen: boolean;
  onScriptStep: (answer: ScriptStepAnswer) => void;
}): JSX.Element {
  const price = step.priceCents;
  const locked = media.some((each) => each.isLocked);
  const count = bundleCount(media);
  const shown = media.slice(0, BUNDLE_TILES);
  const more = media.length - shown.length;
  const hers = step.source === 'hers' && creatorId !== null ? creatorId : null;
  const what = `${count}${price === null ? ', offert' : `, ${money(price)}`}${locked ? ', flouté' : ''}`;
  return (
    <figure className={`pg-bundle is-${step.state}${locked ? ' is-locked' : ''}`}>
      <div className="pg-bundle__grid" data-n={shown.length} role="img" aria-label={what}>
        {shown.map((each, index) => (
          <Tile
            key={each.scriptMedia?.ref ?? index}
            media={each}
            creatorId={hers}
            more={index === shown.length - 1 ? more : 0}
          />
        ))}
      </div>
      <figcaption className="pg-bundle__cap">
        {text === '' ? null : <span className="pg-bundle__text">{text}</span>}
        <span className="pg-bundle__meta">
          <span className="nv-num">{count}</span>
          <span className={`pg-bundle__price nv-num${price === null ? ' is-free' : ''}`}>
            {price === null ? 'Offert' : money(price)}
          </span>
          {step.source === 'trial' ? <span className="pg-media__essai">Essai</span> : null}
        </span>
      </figcaption>
      {step.state === 'offered' ? null : step.state === 'waiting' ? (
        <>
          <span className="pg-media__act">
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              title="Il dit non à cette étape : le script s’arrête là"
              onClick={() => {
                onScriptStep('refuse');
              }}
            >
              Refuser
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--neon nv-btn--sm"
              disabled={busy || salesFrozen}
              title="Achat fictif : rien ne part vers Reveal ni dans les chiffres"
              onClick={() => {
                onScriptStep('buy');
              }}
            >
              Payer {price === null ? '' : money(price)} (fictif)
            </button>
          </span>
          {salesFrozen ? (
            // Said in words, not in a tooltip a phone never shows (avis Design, 20/11).
            <span className="pg-bundle__frozen">
              Ventes gelées pour ce fan (âge douteux ou détresse) : aucun achat, même fictif
            </span>
          ) : null}
        </>
      ) : (
        <span className="pg-media__state">{STEP_STATE_LABELS[step.state]}</span>
      )}
    </figure>
  );
}

function Tile({
  media,
  creatorId,
  more,
}: {
  media: TurnMedia;
  creatorId: CreatorId | null;
  /** On the last tile shown: how many more the bundle holds. */
  more: number;
}): JSX.Element {
  const ref = media.scriptMedia?.ref ?? '';
  const { kind } = media.description;
  return (
    <span
      className={`pg-tile pg-tile--${kind}${media.isLocked ? ' is-locked' : ''}`}
      title={media.description.factualDescription}
    >
      {creatorId === null ? (
        <span className={`pg-tile__gen pg-tile__gen--${String(trialTint(ref))}`} />
      ) : (
        <HerPicture creatorId={creatorId} platformMediaId={ref} locked={media.isLocked} />
      )}
      {media.isLocked ? (
        <span className="pg-tile__lock">
          <LockIcon />
        </span>
      ) : kind === 'video' ? (
        <span className="pg-tile__play">
          <PlayIcon />
        </span>
      ) : null}
      {media.scriptMedia?.teaser === true ? <span className="pg-tile__tag">Aperçu</span> : null}
      {more > 0 ? <span className="pg-tile__more nv-num">+{more}</span> : null}
    </span>
  );
}

/**
 * One media of hers, from her vault: the platform's blur, and its sharp small picture only once he holds it (the teaser,
 * an offered step, a bought one) and the media blur is off. A locked media stays the blur alone, as he sees it.
 */
function HerPicture({
  creatorId,
  platformMediaId,
  locked,
}: {
  creatorId: CreatorId;
  platformMediaId: string;
  locked: boolean;
}): JSX.Element {
  const vault = useVault(creatorId, false);
  const blurred = useMediaBlur();
  const picture = useMemo(
    () =>
      (vault.data?.folders ?? [])
        .flatMap((folder) => folder.media)
        .find((each) => each.platformMediaId === platformMediaId) ?? null,
    [vault.data, platformMediaId],
  );
  return (
    <>
      <Preview hash={picture?.blurhash ?? null} />
      {picture !== null && !locked && !blurred ? <Sharp creatorId={creatorId} media={picture} /> : null}
    </>
  );
}

function LockIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.8" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

function PlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4.6v6.8L11.4 8Z" />
    </svg>
  );
}
