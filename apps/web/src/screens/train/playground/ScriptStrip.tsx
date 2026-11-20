import type { CreatorId, PlaygroundScriptRun, PlaygroundState } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { money } from './logic';

import { creatorsSearch } from '@/creators/search';

const STATUS_LABELS: Readonly<Record<PlaygroundScriptRun['status'], string>> = {
  open: 'en cours',
  bought_out: 'tout acheté',
  refused: 'refusé',
  stalled: 'arrêté, sans réponse',
  closed_by_human: 'repris à la main',
};

const KIND_LABELS = { free: 'Offerte', paid: 'Payante', bridge: 'Pont' } as const;

type Step = PlaygroundScriptRun['steps'][number];

/** Where a step stands, for its dot: not sent yet, done (offered), waiting (paid), bought, or refused. */
const stepTone = (step: Step): string =>
  step.outcome === null
    ? 'is-todo'
    : step.outcome === 'bought'
      ? 'is-bought'
      : step.outcome === 'refused'
        ? 'is-refused'
        : // An offered step or a bridge is done once sent; a paid one waits for him.
          step.kind === 'paid'
          ? 'is-sent'
          : 'is-done';

/** The word under a step: its kind or its price, and its state once he decided (« 12 € · achetée »). */
const stepWord = (step: Step): string => {
  const what = step.priceCents === null ? KIND_LABELS[step.kind] : money(step.priceCents);
  return step.outcome === 'bought'
    ? `${what} · achetée`
    : step.outcome === 'refused'
      ? `${what} · refusée`
      : what;
};

const stepTitle = (step: Step, index: number): string => {
  const what = `${String(index + 1)}. ${KIND_LABELS[step.kind]}${
    step.priceCents === null ? '' : ` · ${money(step.priceCents)}`
  }`;
  const where =
    step.outcome === null
      ? 'pas encore envoyée'
      : step.outcome === 'bought'
        ? 'achetée (fictif)'
        : step.outcome === 'refused'
          ? 'refusée'
          : 'envoyée';
  return `${what} : ${where}`;
};

/**
 * The script under way (ADR 0103 § 15-17): one of hers, read as production reads it, or a trial one, played by the same
 * rules; its steps as a path, and what he paid fictively. When none of hers can be played, it says why and that the
 * trial scripts play instead. Nothing here reaches Reveal, the sales or the figures.
 */
export function ScriptStrip({
  scripts,
  creatorId,
}: {
  scripts: PlaygroundState['scripts'];
  /** Hers when one of her versions is played: the line leads to her Scripts tab. */
  creatorId: CreatorId | null;
}): JSX.Element | null {
  const { run, unavailable, fictiveSpentCents } = scripts;
  if (run === null && unavailable === null) return null;
  return (
    <section className="pg-script" aria-label={run?.source === 'hers' ? 'Son script' : 'Script d’essai'}>
      {unavailable === null ? null : (
        // Amber for the dot alone, the sentence in ink, short (avis Design, groupes-medias-1).
        <p className="pg-script__why">
          <span className="pg-script__dot" aria-hidden="true" />
          <span>
            {unavailable.label} : les scripts d’essai jouent à la place.
            {creatorId === null || unavailable.code === 'unreadable' ? null : (
              <>
                {' '}
                <Link to="/creatrices" search={creatorsSearch('scripts', creatorId)}>
                  Ses scripts
                </Link>
              </>
            )}
          </span>
        </p>
      )}
      {run === null ? null : (
        <>
          <p className="pg-script__t">
            <span className="pg-script__k">
              {run.source === 'hers'
                ? `Son script · ${run.name}`
                : `Script d’essai${run.moment === 'night' ? ' · Nuit' : run.moment === 'day' ? ' · Jour' : ''}`}
            </span>
            <span className={`pg-script__s is-${run.status}`}>{STATUS_LABELS[run.status]}</span>
          </p>
          <ol className="pg-script__path">
            {run.steps.map((step, index) => (
              // Each step says its state in words, never by its colour alone (avis Design, 20/11).
              <li
                key={index}
                className={`pg-script__step ${stepTone(step)}`}
                title={stepTitle(step, index)}
                aria-label={stepTitle(step, index)}
              >
                <span className="pg-script__dot" aria-hidden="true">
                  {step.outcome === 'bought' ? (
                    <svg viewBox="0 0 12 12" focusable="false">
                      <path d="M3 6.2 5.1 8.3 9 4" />
                    </svg>
                  ) : null}
                </span>
                <span className="pg-script__l" aria-hidden="true">
                  {stepWord(step)}
                </span>
              </li>
            ))}
          </ol>
          <p className="pg-script__f">
            {fictiveSpentCents === 0 ? 'Rien acheté' : `${money(fictiveSpentCents)} achetés`} · fictif, rien
            ne part vers Reveal
          </p>
        </>
      )}
    </section>
  );
}
