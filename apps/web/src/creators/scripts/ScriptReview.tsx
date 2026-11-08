import type {
  ContentDropId,
  CreatorId,
  DropDescriptionsReview,
  DropMediaReview,
  MediaDescriptionId,
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
  reviewKey,
  useDropReview,
  validateDescriptions,
  validateSummary,
  type ReviewOutcome,
} from './review-api';

import { useGrowingArea } from '@/lib/growing-area';

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
  const [error, setError] = useState<string | null>(null);

  const run = async (what: string, call: () => Promise<ReviewOutcome>): Promise<boolean> => {
    setBusy(what);
    setError(null);
    const outcome = await call();
    setBusy(null);
    if (outcome.kind === 'ok') {
      client.setQueryData(reviewKey(creatorId, dropId), outcome.review);
      return true;
    }
    setError(outcome.message);
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
      {error === null ? null : (
        <p className="sx-error nv-swap" role="alert">
          {error}
        </p>
      )}
      <Synthesis
        review={data}
        steps={steps}
        busy={busy !== null}
        onValidate={(summaryId) => void run('summary', () => validateSummary(creatorId, dropId, summaryId))}
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

function Synthesis({
  review,
  steps,
  busy,
  onValidate,
}: {
  review: DropDescriptionsReview;
  steps: readonly ReviewStep[];
  busy: boolean;
  onValidate: (summaryId: NonNullable<DropDescriptionsReview['summary']>['id']) => void;
}): JSX.Element {
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
      </section>
    );
  const names = new Map(steps.map((step) => [step.key, step]));
  return (
    <section className="sx-synth" aria-label="Synthèse du script">
      <div className="sx-synth__head">
        <p className="sx-synth__title">Synthèse</p>
        {summary.validatedAt === null ? null : (
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
            <span className="sx-step__code nv-num">{names.get(one.step)?.code ?? one.step}</span>
            <span className="sx-synth__text">{one.summary}</span>
            {/* The grid of prices does not exist yet (P6-01): never a price from the model (ADR 0056 § 6). */}
            <span className="aa-pill sx-price">Prix à fixer</span>
          </li>
        ))}
      </ol>
      {summary.validatedAt === null ? (
        <div className="sx-actions">
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
        </div>
      ) : null}
    </section>
  );
}

function MediaRow({
  media,
  busy,
  onValidate,
  onCorrect,
}: {
  media: DropMediaReview;
  busy: boolean;
  onValidate: (id: MediaDescriptionId) => void;
  onCorrect: (id: MediaDescriptionId, detailed: string) => Promise<boolean>;
}): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const area = useGrowingArea(draft ?? '');
  const description = media.description;
  const flagged = description?.reviewReasons.includes('flagged') === true;

  return (
    <li className="sx-medium" aria-labelledby={`${id}-kind`}>
      <span className="sx-thumb" data-kind={media.kind} aria-hidden="true" />
      <div className="sx-medium__body">
        <div className="sx-medium__top">
          <span id={`${id}-kind`} className="sx-medium__kind">
            {KIND_LABELS[media.kind]}
          </span>
          {description === null ? null : description.validatedAt !== null ? (
            <span className="aa-pill" data-tone="ok">
              {description.author === 'human' ? 'Corrigée' : 'Validée'}
            </span>
          ) : (
            <span className="aa-pill" data-tone="todo">
              À valider
            </span>
          )}
        </div>
        {!describable(media) ? (
          <p className="ps-muted sx-medium__text">Une note vocale n’est pas décrite.</p>
        ) : description === null ? (
          <p className="ps-muted sx-medium__text">Pas encore décrite.</p>
        ) : draft !== null ? (
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
        ) : (
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
        )}
      </div>
    </li>
  );
}
