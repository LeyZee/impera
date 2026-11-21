import type { DropMediaKind, StockMedium } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type JSX } from 'react';

import {
  correctMedium,
  mediumReviewKey,
  stockKey,
  stockMediaUrl,
  stockThumbnailUrl,
  useMediumReview,
  validateMedium,
  type StockDoor,
  type StockReviewOutcome,
} from './api';
import { STANDING_LABELS, STOCK_NAMES, droppedOnLabel, durationLabel } from './model';

import { useGrowingArea } from '@/lib/growing-area';
import { Dialog } from '@/shell/Dialog';
import { NavIcon } from '@/shell/NavIcon';
import { useMediaBlur } from '@/shell/media-blur';
import { Empty } from '@/shell/states';

const KIND_WORDS: Readonly<Record<DropMediaKind, string>> = {
  image: 'Photo',
  video: 'Vidéo',
  audio: 'Vocal',
};

/**
 * A medium of her coffre in large (ADR 0162 § 4): the photo whole, the video played with its controls, the arrows
 * (and the keyboard's) to the one before and after, and beside it its description, the same for the agency and for
 * her: « C'est bien ça » validates it in the reader's name, « Corriger » writes over it and validates as it saves.
 * Under « Flou des médias » it opens blurred until « Voir net ».
 */
export function StockViewer({
  door,
  media,
  index,
  audience,
  onIndex,
  onClose,
}: {
  door: StockDoor;
  media: readonly StockMedium[];
  index: number;
  /** `team`: the owner or a manager; `her`: the creator, tutoyée. */
  audience: 'team' | 'her';
  onIndex: (index: number) => void;
  onClose: () => void;
}): JSX.Element | null {
  const medium = media[index];
  const count = media.length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowRight') onIndex((index + 1) % count);
      if (event.key === 'ArrowLeft') onIndex((index - 1 + count) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [index, count, onIndex]);

  if (medium === undefined) return null;
  return (
    <Dialog
      title={`${STOCK_NAMES[medium.category]} · ${KIND_WORDS[medium.kind]}`}
      lead={`${String(index + 1)} sur ${String(count)} · déposé le ${droppedOnLabel(medium.droppedAt)} · ${STANDING_LABELS[medium.standing]}`}
      className="st-viewer"
      onClose={onClose}
    >
      <ViewerBody
        key={medium.fileId}
        door={door}
        medium={medium}
        audience={audience}
        many={count > 1}
        onPrevious={() => {
          onIndex((index - 1 + count) % count);
        }}
        onNext={() => {
          onIndex((index + 1) % count);
        }}
      />
    </Dialog>
  );
}

function ViewerBody({
  door,
  medium,
  audience,
  many,
  onPrevious,
  onNext,
}: {
  door: StockDoor;
  medium: StockMedium;
  audience: 'team' | 'her';
  many: boolean;
  onPrevious: () => void;
  onNext: () => void;
}): JSX.Element {
  const blurred = useMediaBlur();
  const [revealed, setRevealed] = useState(false);
  const [fallback, setFallback] = useState(false);
  const thumbnail = stockThumbnailUrl(door, medium.dropId, medium.fileId);
  const source = stockMediaUrl(door, medium.dropId, medium.fileId);
  const shown = blurred && !revealed ? 'false' : 'true';
  const length = durationLabel(medium.durationMs);

  const frame =
    medium.kind === 'audio' ? (
      <audio className="st-viewer__audio" src={source} controls preload="metadata" />
    ) : medium.kind === 'video' && !fallback ? (
      <video
        className="st-viewer__media nv-blurrable"
        data-revealed={shown}
        src={source}
        poster={thumbnail}
        controls={shown === 'true'}
        playsInline
        preload="metadata"
        onError={() => {
          setFallback(true);
        }}
      />
    ) : (
      <img
        className="st-viewer__media nv-blurrable"
        data-revealed={shown}
        src={fallback ? thumbnail : source}
        alt=""
        onError={() => {
          if (!fallback) setFallback(true);
        }}
      />
    );

  return (
    <div className="tm-dialog__body st-viewer__body">
      <div className="st-viewer__stage">
        <div className="st-viewer__frame">
          {frame}
          {blurred && !revealed && medium.kind !== 'audio' ? (
            <button
              type="button"
              className="nv-btn nv-btn--sm nv-btn--soft st-viewer__reveal"
              onClick={() => {
                setRevealed(true);
              }}
            >
              <NavIcon name="eye" />
              Voir net
            </button>
          ) : null}
          {many ? (
            <>
              <button
                type="button"
                className="nv-iconbtn st-viewer__step st-viewer__step--previous"
                aria-label="Média précédent"
                onClick={onPrevious}
              >
                <Arrow />
              </button>
              <button
                type="button"
                className="nv-iconbtn st-viewer__step st-viewer__step--next"
                aria-label="Média suivant"
                onClick={onNext}
              >
                <Arrow />
              </button>
            </>
          ) : null}
        </div>
        <p className="st-viewer__facts nv-num">
          {length === null ? null : <span>{length}</span>}
          {medium.erasesAt === null ? null : (
            <span>Original gardé jusqu’au {droppedOnLabel(medium.erasesAt)}</span>
          )}
          {fallback ? <span>Sa vignette : l’original ne s’affiche pas ici.</span> : null}
        </p>
      </div>
      <Description door={door} medium={medium} audience={audience} />
    </div>
  );
}

function Arrow(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Its description: read in its drop's review, the same rows the agency validates. */
function Description({
  door,
  medium,
  audience,
}: {
  door: StockDoor;
  medium: StockMedium;
  audience: 'team' | 'her';
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const review = useMediumReview(door, medium.dropId);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useGrowingArea(draft ?? '');
  const her = audience === 'her';

  const run = async (call: () => Promise<StockReviewOutcome>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const outcome = await call();
    setBusy(false);
    if (outcome.kind === 'ok') {
      client.setQueryData(mediumReviewKey(door, medium.dropId), outcome.review);
      await client.invalidateQueries({ queryKey: stockKey(door), exact: true });
      return true;
    }
    setError(outcome.message);
    await client.invalidateQueries({ queryKey: mediumReviewKey(door, medium.dropId) });
    return false;
  };

  const head = (
    <div className="st-desc__head">
      <span className="st-desc__title">{her ? 'Ce que l’IA a compris' : 'Description'}</span>
    </div>
  );

  if (review.data === undefined)
    return (
      <div className="st-desc">
        {head}
        {review.isError ? (
          <p className="st-error" role="alert">
            La description ne se charge pas.
          </p>
        ) : (
          <div className="ps-skeleton ps-skeleton--tall" aria-busy="true" />
        )}
      </div>
    );

  const description = review.data.media.find((one) => one.fileId === medium.fileId)?.description ?? null;
  if (description === null)
    return (
      <div className="st-desc">
        {head}
        <Empty title={medium.description === 'failed' ? 'L’IA n’a pas su le décrire.' : 'Pas encore décrit.'}>
          {medium.description === 'failed'
            ? her
              ? 'L’agence s’en occupe.'
              : 'Réessaie ou décris-le à la main depuis Dépôts.'
            : 'L’IA le décrit dans quelques minutes.'}
        </Empty>
      </div>
    );

  const validated = description.validatedAt !== null;
  const provenance = validated
    ? description.author === 'sense'
      ? 'Validée'
      : 'Corrigée à la main'
    : 'Écrite par l’IA, à valider';

  return (
    <div className="st-desc nv-swap">
      {head}
      <span className="st-pill" data-tone={validated ? 'ok' : 'todo'}>
        {provenance}
      </span>
      {error === null ? null : (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}
      {draft === null ? (
        <>
          <p className="st-desc__text">{description.detailed}</p>
          <div className="st-desc__actions">
            {validated ? null : (
              <button
                type="button"
                className="nv-btn nv-btn--sm nv-btn--soft"
                disabled={busy}
                onClick={() => void run(() => validateMedium(door, medium.dropId, description.id))}
              >
                {busy ? 'Validation…' : 'C’est bien ça'}
              </button>
            )}
            <button
              type="button"
              className="nv-btn nv-btn--sm nv-btn--plain"
              disabled={busy}
              onClick={() => {
                setDraft(description.detailed);
              }}
            >
              Corriger
            </button>
          </div>
        </>
      ) : (
        <form
          className="nv-field st-desc__form"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (text === '') return;
            void run(() => correctMedium(door, medium.dropId, description.id, text)).then((done) => {
              if (done) setDraft(null);
            });
          }}
        >
          <label className="nv-field__label" htmlFor={`${id}-text`}>
            {her ? 'Ce que montre ton média' : 'Ce que montre le média'}
          </label>
          <textarea
            id={`${id}-text`}
            ref={area}
            className="nv-field__control st-desc__area"
            value={draft}
            maxLength={6000}
            rows={4}
            data-autofocus
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <div className="st-desc__actions">
            <button
              type="button"
              className="nv-btn nv-btn--sm nv-btn--plain"
              disabled={busy}
              onClick={() => {
                setDraft(null);
              }}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="nv-btn nv-btn--sm nv-btn--soft"
              disabled={busy || draft.trim() === ''}
            >
              Enregistrer et valider
            </button>
          </div>
        </form>
      )}
      <p className="st-desc__note">
        {her
          ? 'Ta correction compte tout de suite, pour toi comme pour l’agence. L’ancienne version reste au journal.'
          : 'Toi, le manager et la créatrice voyez et modifiez le même texte. Les chatteurs et l’IA de chatting le lisent.'}
      </p>
    </div>
  );
}
