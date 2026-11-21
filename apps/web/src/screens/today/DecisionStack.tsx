import { useState, type JSX } from 'react';

interface Answer {
  id: string;
  label: string;
  text?: string;
}

/** One question put to her: what it is about, in one line, and two or three answers. */
export interface DecisionCard {
  id: string;
  /** The colour of the content it is about, the agenda's (a dot, never a bar). */
  category: 'shoot' | 'live' | 'post' | 'socials';
  question: string;
  context: string;
  /** Three captions read in full: each answer is a row with its whole text. */
  layout: 'buttons' | 'rows';
  answers: readonly Answer[];
  /** What she hears once she answered, by answer; the card leaves after it. */
  noted?: Readonly<Record<string, string>>;
  /** Other ideas can be asked for, this many times more. */
  otherIdeasLeft?: number;
}

/** What she may ask of other ideas in one touch; her own words come beside them. */
const HINTS = ['Plus courte', 'Plus drôle', 'Plus coquine', 'Avec une question', 'Parle du lieu'] as const;

/**
 * « À décider », hers: one question at a time, on top of Aujourd'hui. The next one enters once she answered or put
 * the first aside; nothing shows when nothing waits. « Plus tard » is always there, said plainly.
 */
export function DecisionStack({
  cards,
  onAnswer,
  onLater,
  onOtherIdeas,
}: {
  cards: readonly DecisionCard[];
  onAnswer: (cardId: string, answerId: string) => void;
  onLater: (cardId: string) => void;
  /** Three other answers for a card, from what she asked for. */
  onOtherIdeas: (cardId: string, hints: readonly string[], wish: string) => Promise<readonly Answer[]>;
}): JSX.Element | null {
  const [index, setIndex] = useState(0);
  const [noted, setNoted] = useState<string | null>(null);
  const card = cards[index];
  if (card === undefined) return null;
  const next = (): void => {
    setNoted(null);
    setIndex((at) => at + 1);
  };
  return (
    <section key={card.id} className="nv-plate nv-enter ag-scope" aria-labelledby="sc-ask-title">
      <div className="sc-ask" data-cat={card.category}>
        <header className="sc-ask__head">
          <span className="sc-ask__dot" aria-hidden="true" />
          <span className="sc-ask__eyebrow">À décider</span>
          {cards.length > 1 ? (
            <span className="sc-ask__count nv-num">
              {String(index + 1)} sur {String(cards.length)}
            </span>
          ) : null}
        </header>
        {noted === null ? (
          <Question
            card={card}
            onAnswer={(answerId) => {
              onAnswer(card.id, answerId);
              setNoted(card.noted?.[answerId] ?? 'C’est noté.');
            }}
            onLater={() => {
              onLater(card.id);
              next();
            }}
            onOtherIdeas={(hints, wish) => onOtherIdeas(card.id, hints, wish)}
          />
        ) : (
          <div className="sc-ask__noted nv-enter" role="status">
            <Check />
            <p>{noted}</p>
            <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={next}>
              {index + 1 < cards.length ? 'Suivante' : 'Fermer'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Question({
  card,
  onAnswer,
  onLater,
  onOtherIdeas,
}: {
  card: DecisionCard;
  onAnswer: (answerId: string) => void;
  onLater: () => void;
  onOtherIdeas: (hints: readonly string[], wish: string) => Promise<readonly Answer[]>;
}): JSX.Element {
  const [answers, setAnswers] = useState(card.answers);
  const [left, setLeft] = useState(card.otherIdeasLeft ?? 0);
  const [asking, setAsking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [hints, setHints] = useState<readonly string[]>([]);
  const [wish, setWish] = useState('');
  const ask = (): void => {
    setThinking(true);
    setAsking(false);
    void onOtherIdeas(hints, wish).then((other) => {
      setAnswers(other);
      setLeft((count) => count - 1);
      setHints([]);
      setWish('');
      setThinking(false);
    });
  };
  return (
    <>
      <h2 id="sc-ask-title" className="sc-ask__question">
        {card.question}
      </h2>
      <p className="sc-ask__context">{card.context}</p>
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
      ) : card.layout === 'rows' ? (
        <div className="sc-ask__rows">
          {answers.map((answer, at) => (
            <button
              key={answer.id}
              type="button"
              className="sc-ask__row nv-enter"
              style={{ '--nv-i': at }}
              onClick={() => {
                onAnswer(answer.id);
              }}
            >
              <span className="sc-ask__style">{answer.label}</span>
              <span className="sc-ask__text">{answer.text}</span>
              <span className="sc-ask__pick" aria-hidden="true">
                Choisir
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="sc-ask__buttons">
          {answers.map((answer) => (
            <button
              key={answer.id}
              type="button"
              className="nv-btn nv-btn--soft sc-ask__btn"
              onClick={() => {
                onAnswer(answer.id);
              }}
            >
              {answer.label}
            </button>
          ))}
        </div>
      )}
      {asking ? (
        <div className="sc-ask__wish nv-enter">
          <p className="sc-ask__wish-title">Qu’est-ce que tu voudrais ?</p>
          <div className="sc-ask__hints" role="group" aria-label="Ce que tu voudrais">
            {HINTS.map((hint) => (
              <button
                key={hint}
                type="button"
                className="nv-chip"
                aria-pressed={hints.includes(hint)}
                onClick={() => {
                  setHints((now) =>
                    now.includes(hint) ? now.filter((one) => one !== hint) : [...now, hint],
                  );
                }}
              >
                {hint}
              </button>
            ))}
          </div>
          <label className="nv-field">
            <span className="nv-field__label">Ou dis-le avec tes mots (facultatif)</span>
            <input
              className="nv-field__control"
              value={wish}
              maxLength={200}
              placeholder="Parle de la soirée de samedi"
              onChange={(event) => {
                setWish(event.target.value);
              }}
            />
          </label>
          <button type="button" className="nv-btn nv-btn--soft sc-ask__btn" onClick={ask}>
            Proposer trois autres
          </button>
        </div>
      ) : null}
      <footer className="sc-ask__foot">
        {left > 0 && !asking && !thinking ? (
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
