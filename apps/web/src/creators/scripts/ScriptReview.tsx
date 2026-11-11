import type {
  ContentDropId,
  CreatorId,
  DropDescriptionsReview,
  DropMediaReview,
  MediaDescriptionId,
  ScriptDropSummary,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import {
  KIND_LABELS,
  REASON_LABELS,
  describable,
  reviewSteps,
  standingLine,
  type ReviewStep,
} from './review';
import {
  correctDescription,
  correctSummary,
  mediaUrl,
  reviewKey,
  thumbnailUrl,
  useDropReview,
  validateDescriptions,
  validateSummary,
  type ReviewOutcome,
} from './review-api';

import { useGrowingArea } from '@/lib/growing-area';
import { Dialog } from '@/shell/Dialog';
import { NavIcon } from '@/shell/NavIcon';
import { useMediaBlur } from '@/shell/media-blur';

/**
 * The review of a sent script (SC-04 lot c3, ADR 0030 § 3, ADR 0083 § 7), under its card: the synthesis first, each
 * step with the price of the grid beside it, then each step's media with its description. « Tout valider » validates
 * a step's descriptions that nothing holds back; one the code holds (a doubt, an alert) is validated alone, and any
 * one is corrected inline. Every answer of the server is the script's review as it now stands.
 */
export function ScriptReview({
  creatorId,
  dropId,
  code,
}: {
  creatorId: CreatorId;
  dropId: ContentDropId;
  code: string;
}): JSX.Element {
  const client = useQueryClient();
  const review = useDropReview(creatorId, dropId, true);
  const [busy, setBusy] = useState<string | null>(null);
  // The refusal, and what it answers: one of the synthesis is said in its form, beside « Enregistrer et valider ».
  const [error, setError] = useState<{ readonly what: string; readonly message: string } | null>(null);

  const run = async (what: string, call: () => Promise<ReviewOutcome>): Promise<boolean> => {
    setBusy(what);
    setError(null);
    const outcome = await call();
    setBusy(null);
    if (outcome.kind === 'ok') {
      client.setQueryData(reviewKey(creatorId, dropId), outcome.review);
      return true;
    }
    setError({ what, message: outcome.message });
    // A newer row or synthesis came meanwhile: the review is read again, so that the screen shows it.
    await client.invalidateQueries({ queryKey: reviewKey(creatorId, dropId) });
    return false;
  };

  if (review.data === undefined) {
    if (review.isError)
      return (
        <div className="sx-review">
          <p className="sx-error" role="alert">
            Les descriptions de {code} ne se chargent pas.
          </p>
          <button
            type="button"
            className="nv-btn nv-btn--sm nv-btn--soft ps-self-start"
            onClick={() => void review.refetch()}
          >
            Réessayer
          </button>
        </div>
      );
    return <div className="sx-review ps-skeleton ps-skeleton--tall" aria-busy="true" />;
  }

  const data = review.data;
  const steps = reviewSteps(data);
  return (
    <div className="sx-review nv-swap" aria-label={`Descriptions de ${code}`} role="region">
      <p className="sx-review__standing nv-num">{standingLine(data)}</p>
      {error === null || error.what === 'summary' ? null : (
        <p className="sx-error nv-swap" role="alert">
          {error.message}
        </p>
      )}
      <Synthesis
        review={data}
        steps={steps}
        busy={busy !== null}
        error={error?.what === 'summary' ? error.message : null}
        onValidate={(summaryId) => void run('summary', () => validateSummary(creatorId, dropId, summaryId))}
        onCorrect={(summaryId, content) =>
          run('summary', () => correctSummary(creatorId, dropId, summaryId, content))
        }
      />
      <ol className="sx-steps">
        {steps.map((step) => (
          <li key={step.key} className="sx-step">
            <div className="sx-step__head">
              <span className="sx-step__code nv-num">{step.code}</span>
              <span className="sx-step__name">{step.name}</span>
              {step.batch.length > 0 ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--sm nv-btn--soft sx-step__all"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(step.key, () => validateDescriptions(creatorId, dropId, step.batch))
                  }
                >
                  {busy === step.key ? 'Validation…' : 'Tout valider'}
                </button>
              ) : null}
            </div>
            <ul className="sx-media">
              {step.media.map((media) => (
                <MediaRow
                  key={media.fileId}
                  media={media}
                  code={step.code}
                  urls={{
                    thumbnail: thumbnailUrl(creatorId, dropId, media.fileId),
                    media: mediaUrl(creatorId, dropId, media.fileId),
                  }}
                  busy={busy !== null}
                  onValidate={(id) => void run(id, () => validateDescriptions(creatorId, dropId, [id]))}
                  onCorrect={(id, detailed) =>
                    run(id, () => correctDescription(creatorId, dropId, id, detailed))
                  }
                />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

type SummaryId = NonNullable<DropDescriptionsReview['summary']>['id'];

/**
 * Her script's synthesis: what the brain told, or what the agency wrote over it (SC-04 lot c5). « Corriger » opens its
 * context and each step's two texts; what is written is validated as it is saved. The steps stay hers, in their order,
 * and a price never enters it: the server refuses one and says why.
 */
function Synthesis({
  review,
  steps,
  busy,
  error,
  onValidate,
  onCorrect,
}: {
  review: DropDescriptionsReview;
  steps: readonly ReviewStep[];
  busy: boolean;
  error: string | null;
  onValidate: (summaryId: SummaryId) => void;
  onCorrect: (summaryId: SummaryId, content: ScriptDropSummary) => Promise<boolean>;
}): JSX.Element {
  const [draft, setDraft] = useState<ScriptDropSummary | null>(null);
  const summary = review.summary;
  if (!summary?.current)
    return (
      <section className="sx-synth" aria-label="Synthèse du script">
        <p className="sx-synth__title">Synthèse</p>
        <p className="ps-muted">
          {summary === null
            ? 'Elle s’écrit quand chaque photo et chaque vidéo du script est décrite.'
            : 'Une description a changé : elle se réécrit, puis revient ici.'}
        </p>
        {error === null ? null : (
          <p className="sx-error nv-swap" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  const names = new Map(steps.map((step) => [step.key, step]));
  const codeOf = (step: string) => names.get(step)?.code ?? step;

  if (draft !== null) {
    const filled =
      draft.shootingContext.trim() !== '' &&
      draft.steps.every((one) => one.overview.trim() !== '' && one.summary.trim() !== '');
    const setStep = (index: number, field: 'overview' | 'summary', text: string) => {
      setDraft({
        ...draft,
        steps: draft.steps.map((one, at) => (at === index ? { ...one, [field]: text } : one)),
      });
    };
    return (
      <section className="sx-synth" aria-label="Synthèse du script">
        <p className="sx-synth__title">Corriger la synthèse</p>
        <p className="ps-muted">
          Ce que tu écris remplace la synthèse et vaut validation. Pas de prix ici : ils viennent de la
          grille.
        </p>
        <form
          className="sx-correct"
          onSubmit={(event) => {
            event.preventDefault();
            if (!filled) return;
            const written: ScriptDropSummary = {
              shootingContext: draft.shootingContext.trim(),
              steps: draft.steps.map((one) => ({
                step: one.step,
                overview: one.overview.trim(),
                summary: one.summary.trim(),
              })),
            };
            void onCorrect(summary.id, written).then((done) => {
              if (done) setDraft(null);
            });
          }}
        >
          <GrowingField
            label="Le tournage"
            value={draft.shootingContext}
            maxLength={2000}
            autofocus
            onChange={(text) => {
              setDraft({ ...draft, shootingContext: text });
            }}
          />
          <ol className="sx-synth__edit">
            {draft.steps.map((one, index) => (
              <li key={one.step} className="sx-synth__edit-step">
                <p className="sx-synth__edit-head">
                  <span className="sx-step__code nv-num">{codeOf(one.step)}</span>
                  <span className="sx-step__name">{names.get(one.step)?.name}</span>
                </p>
                <GrowingField
                  label="En une ligne"
                  value={one.summary}
                  maxLength={400}
                  onChange={(text) => {
                    setStep(index, 'summary', text);
                  }}
                />
                <GrowingField
                  label="Le déroulé"
                  value={one.overview}
                  maxLength={2000}
                  onChange={(text) => {
                    setStep(index, 'overview', text);
                  }}
                />
              </li>
            ))}
          </ol>
          {error === null ? null : (
            <p className="sx-error nv-swap" role="alert">
              {error}
            </p>
          )}
          <div className="sx-actions">
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
            <button type="submit" className="nv-btn nv-btn--sm nv-btn--soft" disabled={busy || !filled}>
              Enregistrer et valider
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="sx-synth" aria-label="Synthèse du script">
      <div className="sx-synth__head">
        <p className="sx-synth__title">Synthèse</p>
        {summary.author === 'human' ? (
          <span className="aa-pill" data-tone="ok">
            Corrigée à la main
          </span>
        ) : summary.validatedAt === null ? null : (
          <span className="aa-pill" data-tone="ok">
            Validée
          </span>
        )}
      </div>
      <p className="sx-synth__context">{summary.content.shootingContext}</p>
      {summary.reviewReasons.includes('price') ? (
        <p className="sx-note" data-tone="warn">
          Elle cite un montant : les prix viennent de la grille de l’agence, jamais de la synthèse.
        </p>
      ) : null}
      <ol className="sx-synth__steps">
        {summary.content.steps.map((one) => (
          <li key={one.step} className="sx-synth__step">
            <span className="sx-step__code nv-num">{codeOf(one.step)}</span>
            <span className="sx-synth__text">{one.summary}</span>
            {/* The grid of prices does not exist yet (P6-01): never a price from the model (ADR 0056 § 6). */}
            <span className="aa-pill sx-price">Prix à fixer</span>
          </li>
        ))}
      </ol>
      {error === null ? null : (
        <p className="sx-error nv-swap" role="alert">
          {error}
        </p>
      )}
      <div className="sx-actions">
        <button
          type="button"
          className="nv-btn nv-btn--sm nv-btn--plain"
          disabled={busy}
          onClick={() => {
            setDraft(summary.content);
          }}
        >
          Corriger
        </button>
        {summary.validatedAt === null ? (
          <button
            type="button"
            className="nv-btn nv-btn--sm nv-btn--soft"
            disabled={busy}
            onClick={() => {
              onValidate(summary.id);
            }}
          >
            Valider la synthèse
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** A labelled text field that grows with its text (useGrowingArea), one per text of the synthesis. */
function GrowingField({
  label,
  value,
  maxLength,
  autofocus = false,
  onChange,
}: {
  label: string;
  value: string;
  maxLength: number;
  autofocus?: boolean;
  onChange: (text: string) => void;
}): JSX.Element {
  const id = useId();
  const area = useGrowingArea(value);
  return (
    <div className="nv-field">
      <label className="nv-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        ref={area}
        className="nv-field__control sx-correct__area"
        value={value}
        maxLength={maxLength}
        rows={2}
        data-autofocus={autofocus ? true : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

interface MediaActions {
  readonly busy: boolean;
  readonly onValidate: (id: MediaDescriptionId) => void;
  readonly onCorrect: (id: MediaDescriptionId, detailed: string) => Promise<boolean>;
}

interface MediaUrls {
  readonly thumbnail: string;
  readonly media: string;
}

function MediaRow({
  media,
  code,
  urls,
  ...actions
}: MediaActions & { media: DropMediaReview; code: string; urls: MediaUrls }): JSX.Element {
  const id = useId();
  const [viewing, setViewing] = useState(false);
  const [broken, setBroken] = useState(false);
  const description = media.description;
  const picture = media.thumbnail && !broken;
  const opens = describable(media) && (media.thumbnail || media.original);

  const thumb = picture ? (
    <img
      className="sx-thumb__img nv-blurrable"
      src={urls.thumbnail}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => {
        setBroken(true);
      }}
    />
  ) : null;

  return (
    <li className="sx-medium" aria-labelledby={`${id}-kind`}>
      {opens ? (
        <button
          type="button"
          className="sx-thumb sx-thumb--open"
          data-kind={media.kind}
          data-picture={picture}
          aria-label={`Voir ${media.kind === 'video' ? 'la vidéo' : 'la photo'} en grand`}
          onClick={() => {
            setViewing(true);
          }}
        >
          {thumb}
        </button>
      ) : (
        <span className="sx-thumb" data-kind={media.kind} data-picture={picture} aria-hidden="true">
          {thumb}
        </span>
      )}
      <div className="sx-medium__body">
        <div className="sx-medium__top">
          <span id={`${id}-kind`} className="sx-medium__kind">
            {KIND_LABELS[media.kind]}
          </span>
          <DescriptionPill media={media} />
        </div>
        {description === null || !describable(media) ? (
          <p className="ps-muted sx-medium__text">
            {describable(media) ? 'Pas encore décrite.' : 'Une note vocale n’est pas décrite.'}
          </p>
        ) : (
          <DescriptionBlock description={description} {...actions} />
        )}
      </div>
      {viewing ? (
        <MediaViewer
          media={media}
          code={code}
          urls={urls}
          {...actions}
          onClose={() => {
            setViewing(false);
          }}
        />
      ) : null}
    </li>
  );
}

function DescriptionPill({ media }: { media: DropMediaReview }): JSX.Element | null {
  const description = media.description;
  if (description === null) return null;
  return description.validatedAt !== null ? (
    <span className="aa-pill" data-tone="ok">
      {description.author === 'human' ? 'Corrigée' : 'Validée'}
    </span>
  ) : (
    <span className="aa-pill" data-tone="todo">
      À valider
    </span>
  );
}

/** A description as the agency reads it: its words, what holds it back, her feeling, « Corriger » and « Valider ». */
function DescriptionBlock({
  description,
  busy,
  onValidate,
  onCorrect,
}: MediaActions & { description: NonNullable<DropMediaReview['description']> }): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const area = useGrowingArea(draft ?? '');
  const flagged = description.reviewReasons.includes('flagged');

  if (draft !== null)
    return (
      <form
        className="nv-field sx-correct"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (text === '') return;
          void onCorrect(description.id, text).then((done) => {
            if (done) setDraft(null);
          });
        }}
      >
        <label className="nv-field__label" htmlFor={`${id}-text`}>
          Ce que montre le média
        </label>
        <textarea
          id={`${id}-text`}
          ref={area}
          className="nv-field__control sx-correct__area"
          value={draft}
          maxLength={6000}
          rows={3}
          data-autofocus
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <div className="sx-actions">
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
    );

  return (
    <>
      <p className="sx-medium__text">{description.detailed}</p>
      {description.reviewReasons.length === 0 ? null : (
        <ul className="sx-reasons" aria-label="À vérifier">
          {description.reviewReasons.map((reason) => (
            <li key={reason} className="sx-reason" data-tone={reason === 'flagged' ? 'alert' : 'warn'}>
              {REASON_LABELS[reason]}
            </li>
          ))}
        </ul>
      )}
      {description.creatorNote === null ? null : (
        <p className="sx-medium__note">Son ressenti : {description.creatorNote}</p>
      )}
      <div className="sx-actions">
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
        {/* Held by the code: validated alone, after it is read; never under « Tout valider ». */}
        {description.validatedAt === null && description.reviewReasons.length > 0 ? (
          <button
            type="button"
            className={`nv-btn nv-btn--sm ${flagged ? 'nv-btn--plain' : 'nv-btn--soft'}`}
            disabled={busy}
            onClick={() => {
              onValidate(description.id);
            }}
          >
            Valider celle-ci
          </button>
        ) : null}
      </div>
    </>
  );
}

/**
 * Her medium in large (SC-04 lot c4), its description beside it: the original while it is held (a video plays in the
 * parts it asks), its reduced picture once the original is gone or when the browser cannot show it (a HEIC photo).
 * Under « Flou des médias » it opens blurred, a video without its controls (blurred and cropped with it otherwise);
 * « Voir net » shows this one alone, its controls with it, for as long as it is open.
 */
function MediaViewer({
  media,
  code,
  urls,
  onClose,
  ...actions
}: MediaActions & {
  media: DropMediaReview;
  code: string;
  urls: MediaUrls;
  onClose: () => void;
}): JSX.Element {
  const blurred = useMediaBlur();
  const [revealed, setRevealed] = useState(false);
  const [fallback, setFallback] = useState(!media.original);
  const description = media.description;
  const shown = blurred && !revealed ? 'false' : 'true';
  const frame =
    media.kind === 'video' && !fallback ? (
      <video
        className="sx-viewer__media nv-blurrable"
        data-revealed={shown}
        src={urls.media}
        poster={media.thumbnail ? urls.thumbnail : undefined}
        controls={shown === 'true'}
        playsInline
        preload="metadata"
        onError={() => {
          setFallback(true);
        }}
      />
    ) : fallback && !media.thumbnail ? (
      <p className="ps-muted sx-viewer__empty">Ce média ne s’affiche pas ici : son original est effacé.</p>
    ) : (
      <img
        className="sx-viewer__media nv-blurrable"
        data-revealed={shown}
        src={fallback ? urls.thumbnail : urls.media}
        alt={description?.detailed ?? KIND_LABELS[media.kind]}
        onError={() => {
          setFallback(true);
        }}
      />
    );
  return (
    <Dialog
      title={`${KIND_LABELS[media.kind]} · ${code}`}
      lead={
        fallback && media.thumbnail
          ? 'Sa vignette : l’original est effacé ou ne s’affiche pas dans le navigateur.'
          : undefined
      }
      className="sx-viewer"
      busy={actions.busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body sx-viewer__body">
        <div className="sx-viewer__frame">
          {frame}
          {blurred && !revealed ? (
            <button
              type="button"
              className="nv-btn nv-btn--sm nv-btn--soft sx-viewer__reveal"
              onClick={() => {
                setRevealed(true);
              }}
            >
              <NavIcon name="eye" />
              Voir net
            </button>
          ) : null}
        </div>
        <div className="sx-viewer__side">
          <div className="sx-medium__top">
            <span className="sx-medium__kind">Sa description</span>
            <DescriptionPill media={media} />
          </div>
          {description === null ? (
            <p className="ps-muted sx-medium__text">Pas encore décrite.</p>
          ) : (
            <DescriptionBlock description={description} {...actions} />
          )}
        </div>
      </div>
    </Dialog>
  );
}
