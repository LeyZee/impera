import type { PlaygroundScriptRun } from '@impera/contracts';
import type { JSX } from 'react';

import { money } from './logic';

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
 * The trial script under way (ADR 0103 § 15-17): an invented script played by the same rules as production, its steps
 * as a path, and what he paid fictively. Nothing here reaches Reveal, the sales or the figures.
 */
export function ScriptStrip({
  run,
  fictiveSpentCents,
}: {
  run: PlaygroundScriptRun;
  fictiveSpentCents: number;
}): JSX.Element {
  return (
    <section className="pg-script" aria-label="Script d’essai">
      <p className="pg-script__t">
        <span className="pg-script__k">
          Script d’essai{run.moment === 'night' ? ' · Nuit' : run.moment === 'day' ? ' · Jour' : ''}
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
        {fictiveSpentCents === 0 ? 'Rien acheté' : `${money(fictiveSpentCents)} achetés`} · fictif, rien ne
        part vers Reveal
      </p>
    </section>
  );
}
