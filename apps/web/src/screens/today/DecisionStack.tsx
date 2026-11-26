import {
  CAPTION_HINT_LABELS,
  CAPTION_HINTS,
  DECISION_WISH_MAX,
  type CreatorDecision,
  type CreatorDecisionKind,
  type DecisionAnswer,
} from '@impera/contracts';
import { useState, type JSX } from 'react';

interface Hint {
  /** How the server names it. */
  readonly key: string;
  readonly label: string;
}

/**
 * What she may ask of other ideas in one touch, by kind of decision; her own words come beside them. A kind without
 * hints never shows the gesture.
 */
const HINTS: Partial<Record<CreatorDecisionKind, readonly Hint[]>> = {
  caption: CAPTION_HINTS.map((key) => ({ key, label: CAPTION_HINT_LABELS[key] })),
};

/** Three other answers for a decision, from what she asked for. */
export type OtherIdeas = (
  decision: CreatorDecision,
  hints: readonly string[],
  wish: string,
) => Promise<readonly DecisionAnswer[]>;

/**
 * « À décider », hers (ADR 0164): one question at a time, on top of Aujourd'hui. The next one enters once she
 * answered or put the first aside; nothing shows when nothing waits. « Plus tard » is always there, said plainly.
 * The list is the server's: an answer kept leaves it, and the count goes on from what she already answered here.
 */
export function DecisionStack({
  decisions,
  onAnswer,
  onLater,
  onOtherIdeas,
}: {
  decisions: readonly CreatorDecision[];
  /** Keeps her answer; what she reads back. */
  onAnswer: (decision: CreatorDecision, key: string) => Promise<string>;
  onLater: (decision: CreatorDecision) => Promise<void>;
  /** Absent while nothing proposes other ideas: the gesture then never shows. */
  onOtherIdeas?: OtherIdeas;
}): JSX.Element | null {
  const [done, setDone] = useState(0);
  const [noted, setNoted] = useState<{ readonly id: string; readonly text: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // While she reads « C'est noté », the list may already have lost the question she answered.
  const waiting = decisions.filter((decision) => decision.id !== noted?.id);
  const [current] = waiting;
  if (noted === null && current === undefined) return null;
  const total = done + waiting.length + (noted === null ? 0 : 1);
  const run = (gesture: () => Promise<void>): void => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    gesture()
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <section
      key={noted?.id ?? current?.id}
      className="nv-plate nv-enter ag-scope"
      aria-labelledby="sc-ask-eyebrow"
    >
      <div className="sc-ask" data-cat={current?.category ?? 'post'} aria-busy={busy}>
        <header className="sc-ask__head">
          <span className="sc-ask__dot" aria-hidden="true" />
          <span id="sc-ask-eyebrow" className="sc-ask__eyebrow">
            À décider
          </span>
          {total > 1 ? (
            <span className="sc-ask__count nv-num">
              {String(done + 1)} sur {String(total)}
            </span>
          ) : null}
        </header>
        {noted !== null ? (
          <div className="sc-ask__noted nv-enter" role="status">
            <Check />
            <p>{noted.text}</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                setDone((count) => count + 1);
                setNoted(null);
              }}
            >
              {waiting.length > 0 ? 'Suivante' : 'Fermer'}
            </button>
          </div>
        ) : current === undefined ? null : (
          <Question
            decision={current}
            failed={failed}
            onAnswer={(key) => {
              run(async () => {
                setNoted({ id: current.id, text: await onAnswer(current, key) });
              });
            }}
            onLater={() => {
              run(() => onLater(current));
            }}
            {...(onOtherIdeas === undefined
              ? {}
              : {
                  onOtherIdeas: (hints: readonly string[], wish: string) =>
                    onOtherIdeas(current, hints, wish),
                })}
          />
        )}
      </div>
    </section>
  );
}

function Question({
  decision,
  failed,
  onAnswer,
  onLater,
  onOtherIdeas,
}: {
  decision: CreatorDecision;
  failed: boolean;
  onAnswer: (key: string) => void;
  onLater: () => void;
  onOtherIdeas?: (hints: readonly string[], wish: string) => Promise<readonly DecisionAnswer[]>;
}): JSX.Element {
  const [answers, setAnswers] = useState<readonly DecisionAnswer[]>(decision.answers);
  const [left, setLeft] = useState(decision.otherIdeasLeft);
  const [asking, setAsking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [missed, setMissed] = useState(false);
  const [hints, setHints] = useState<readonly string[]>([]);
  const [wish, setWish] = useState('');
  const offered = HINTS[decision.kind] ?? [];
  const wished = hints.length > 0 || wish.trim() !== '';
  const ask = (): void => {
    if (onOtherIdeas === undefined || !wished) return;
    setThinking(true);
    setAsking(false);
    setMissed(false);
    onOtherIdeas(hints, wish.trim())
      .then((other) => {
        setAnswers(other);
        setLeft((count) => count - 1);
        setHints([]);
        setWish('');
      })
      .catch(() => {
        setMissed(true);
      })
      .finally(() => {
        setThinking(false);
      });
  };
  return (
    <>
      <h2 className="nv-h3 sc-ask__question">{decision.question}</h2>
      <p className="sc-ask__context">{decision.context}</p>
      {thinking ? (
        <div className="sc-ask__rows" role="status" aria-label="Je cherche trois autres idées…">
          {[0, 1, 2].map((at) => (
            <div key={at} className="sc-ask__row sc-ask__row--wait" style={{ '--nv-i': at }}>
              <span className="nv-skeleton__bar sc-ask__wait-label" />
              <span className="nv-skeleton__bar" />
            </div>
          ))}
          <p className="sc-ask__thinking">Je cherche trois autres idées…</p>
        </div>
      ) : decision.layout === 'rows' ? (
        <div className="sc-ask__rows">
          {answers.map((answer, at) => (
            <button
              key={answer.key}
              type="button"
              className="sc-ask__row nv-enter"
              style={{ '--nv-i': at }}
              onClick={() => {
                onAnswer(answer.key);
              }}
            >
              <span className="sc-ask__style">{answer.label}</span>
              <span className="sc-ask__text">{answer.text}</span>
              <span className="sc-ask__pick" aria-hidden="true">
                Choisir
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="sc-ask__buttons">
          {answers.map((answer) => (
            <button
              key={answer.key}
              type="button"
              className="nv-btn nv-btn--soft sc-ask__btn"
              onClick={() => {
                onAnswer(answer.key);
              }}
            >
              {answer.label}
            </button>
          ))}
        </div>
      )}
      {failed || missed ? (
        <p className="sc-ask__failed" role="alert">
          Ça n’a pas marché. Réessaie dans un instant.
        </p>
      ) : null}
      {asking ? (
        <div className="sc-ask__wish nv-enter">
          <p className="sc-ask__wish-title">Qu’est-ce que tu voudrais ?</p>
          <div className="sc-ask__hints" role="group" aria-label="Ce que tu voudrais">
            {offered.map((hint) => (
              <button
                key={hint.key}
                type="button"
                className="nv-chip"
                aria-pressed={hints.includes(hint.key)}
                onClick={() => {
                  setHints((now) =>
                    now.includes(hint.key) ? now.filter((one) => one !== hint.key) : [...now, hint.key],
                  );
                }}
              >
                {hint.label}
              </button>
            ))}
          </div>
          <label className="nv-field">
            <span className="nv-field__label">Ou dis-le avec tes mots (facultatif)</span>
            <input
              className="nv-field__control"
              value={wish}
              maxLength={DECISION_WISH_MAX}
              placeholder="Parle de la soirée de samedi"
              onChange={(event) => {
                setWish(event.target.value);
              }}
            />
          </label>
          <button type="button" className="nv-btn nv-btn--soft sc-ask__btn" disabled={!wished} onClick={ask}>
            Proposer trois autres
          </button>
        </div>
      ) : null}
      <footer className="sc-ask__foot">
        {onOtherIdeas !== undefined && offered.length > 0 && left > 0 && !asking && !thinking ? (
          <button
            type="button"
            className="nv-btn nv-btn--plain sc-ask__more"
            onClick={() => {
              setAsking(true);
            }}
          >
            <Again />
            D’autres idées
          </button>
        ) : null}
        <button type="button" className="nv-btn nv-btn--plain sc-ask__later" onClick={onLater}>
          Plus tard
        </button>
      </footer>
    </>
  );
}

const Check = (): JSX.Element => (
  <svg className="sc-ask__check" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M7.5 12.5l3 3 6-6.5" pathLength="1" />
  </svg>
);

const Again = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
