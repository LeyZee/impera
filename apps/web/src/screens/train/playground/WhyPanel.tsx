import type { PlaygroundAnswer, PlaygroundState } from '@impera/contracts';
import type { JSX, ReactNode } from 'react';

import { DesireGauge } from './Desire';
import { euros, needsAttention } from './logic';
import {
  actionLabel,
  handoffReasons,
  intentLabel,
  isHandoff,
  riskLabel,
  risksBesideTrap,
  sentimentLabel,
  unansweredReason,
} from './model';

type Level = 'none' | 'ok' | 'warn' | 'blocked' | 'unanswered' | 'handoff';

function levelOf(answer: PlaygroundAnswer | null): Level {
  if (answer === null) return 'none';
  if (isHandoff(answer)) return 'handoff';
  if (unansweredReason(answer) !== null) return 'unanswered';
  if (answer.isBlocked) return 'blocked';
  return needsAttention(answer) ? 'warn' : 'ok';
}

/** The screen knows which of the two happened: the title says it. */
const TITLES: Readonly<Record<Level, string>> = {
  none: 'Pourquoi',
  ok: 'Toutes les règles passent',
  warn: 'À regarder',
  blocked: 'Bloquée avant envoi',
  unanswered: 'Pas de réponse',
  handoff: 'Relayée à un humain',
};

const DOTS: Readonly<Record<Level, string>> = {
  none: 'none',
  ok: 'ok',
  warn: 'warn',
  blocked: 'bad',
  unanswered: 'warn',
  handoff: 'bad',
};

/**
 * Why the agent answered that. Folded by default: it opens by itself only when something was blocked or flagged,
 * and the trainer can open or fold it at any time. No JSON, no tokens: the technical details stay folded.
 */
export function WhyPanel({
  state,
  open,
  onToggle,
}: {
  state: PlaygroundState;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const answer = state.pending;
  const level = levelOf(answer);
  const brief = answer?.brief;
  const signals = answer?.trap?.signals ?? [];
  // A risk the trap already explains is said once, under « Piège ».
  const risks =
    answer === null
      ? []
      : [
          ...new Set([
            ...handoffReasons(answer),
            ...risksBesideTrap(brief?.risks ?? [], signals.length > 0).map(riskLabel),
          ]),
        ];

  if (!open) {
    return (
      <aside className="pg-why nv-glass" data-open="false">
        <button
          type="button"
          className="pg-why__rail"
          aria-expanded="false"
          title="Pourquoi l’agent a répondu ça"
          onClick={onToggle}
        >
          <span>Pourquoi</span>
          <i className={`pg-why__dot is-${DOTS[level]}`} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="pg-why nv-glass" data-open="true" aria-label="Pourquoi">
      <div className="pg-why__h">
        <span className={`pg-why__dot is-${DOTS[level]}`} />
        <span className="pg-why__t">
          <b>{TITLES[level]}</b>
          <span>Pourquoi l’agent a répondu ça</span>
        </span>
        <button type="button" className="pg-why__x" aria-expanded="true" title="Replier" onClick={onToggle}>
          ×
        </button>
      </div>
      {answer === null ? (
        <p className="pg-why__empty">Le raisonnement de la prochaine réponse s’affichera ici.</p>
      ) : (
        <div className="nv-scroll">
          {brief === undefined ? null : (
            <>
              <Sec label="Ce qu’elle a compris">
                {intentLabel(brief.intent)}, {sentimentLabel(brief.sentiment)}
              </Sec>
              <Sec label="Décision">
                <b>{actionLabel(brief.action)}</b>
                {brief.replyBrief === '' ? null : <p>{brief.replyBrief}</p>}
              </Sec>
            </>
          )}
          {answer.offerRefused === undefined ? null : (
            <Sec label="Offre refusée">
              <p className="pg-why__refused">
                Le cerveau voulait proposer un script, la règle a dit non : {answer.offerRefused.label}.
              </p>
            </Sec>
          )}
          {answer.cursor === undefined ? null : <Sec label="Curseur">{answer.cursor.label}</Sec>}
          {answer.desire === undefined ? null : (
            <Sec label="Désir du fan">
              <DesireGauge desire={answer.desire} thresholds={state.desireThresholds} />
            </Sec>
          )}
          {risks.length > 0 ? (
            <Sec label="Risques">
              <ul className="pg-list">
                {risks.map((r) => (
                  <li key={r} className="is-warn">
                    {r}
                  </li>
                ))}
              </ul>
            </Sec>
          ) : null}
          {signals.length > 0 ? (
            <Sec label="Piège">
              <ul className="pg-list">
                {signals.map((t) => (
                  <li key={`${t.kind}-${t.source}`} className="is-warn">
                    {t.label}
                  </li>
                ))}
              </ul>
            </Sec>
          ) : null}
          {(brief?.kycMissing.length ?? 0) > 0 ? (
            <Sec label="Encore à découvrir">{brief?.kycMissing.join(', ')}</Sec>
          ) : null}
          {/* Handed to a human, or no model answered: nothing was written, there is no answer for the review to pass. */}
          {level === 'handoff' || level === 'unanswered' ? null : (
            <Sec label="Relecture avant envoi">
              <ul className="pg-list">
                {answer.violations.length === 0 ? (
                  <li className="is-ok">Mots interdits, longueur, langue, rien qui ressemble à une IA</li>
                ) : (
                  answer.violations.map((v) => (
                    <li key={v.code} className={v.severity === 'blocking' ? 'is-bad' : 'is-warn'}>
                      {v.label}
                    </li>
                  ))
                )}
              </ul>
            </Sec>
          )}
          <div className="pg-why__sec">
            <details className="pg-tech">
              <summary>Détails techniques</summary>
              <dl>
                <dt>Modèle</dt>
                <dd className="pg-mono">
                  {answer.model ?? '—'}
                  {answer.isFallback ? ' (repli)' : ''}
                </dd>
                <dt>Voix</dt>
                <dd className="pg-mono">{state.version.voicePrompt}</dd>
                {answer.desire === undefined ? null : (
                  <>
                    <dt>Poids du désir</dt>
                    <dd className="pg-mono">{answer.desire.weightsVersion}</dd>
                  </>
                )}
                <dt>Latence</dt>
                <dd>{(answer.latencyMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s</dd>
                <dt>Coût</dt>
                <dd>{euros(answer.costEur)}</dd>
              </dl>
              {answer.failure === undefined ? null : <p className="pg-why__fail">{answer.failure}</p>}
            </details>
          </div>
        </div>
      )}
    </aside>
  );
}

function Sec({ label, children }: { label: string; children: ReactNode }): JSX.Element | null {
  if (children === undefined || children === null || children === '') return null;
  return (
    <div className="pg-why__sec">
      <p className="nv-eyebrow">{label}</p>
      <div className="pg-why__b">{children}</div>
    </div>
  );
}
