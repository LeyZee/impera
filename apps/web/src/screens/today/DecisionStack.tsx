import { useState, type JSX } from 'react';

/** One question put to her: what it is about, in one line, and two or three answers. */
export interface DecisionCard {
  id: string;
  /** The colour of the content it is about, the agenda's (a dot, never a bar). */
  category: 'shoot' | 'live' | 'post' | 'socials';
  question: string;
  context: string;
  /** Three captions read in full: each answer is a row with its whole text. */
  layout: 'buttons' | 'rows';
  answers: readonly { id: string; label: string; text?: string }[];
}

/**
 * « À décider », hers: one question at a time, on top of Aujourd'hui. The next one enters once she answered or put
 * the first aside; nothing shows when nothing waits. « Plus tard » is always there, said plainly.
 */
export function DecisionStack({
  cards,
  onAnswer,
  onLater,
}: {
  cards: readonly DecisionCard[];
  onAnswer: (cardId: string, answerId: string) => void;
  onLater: (cardId: string) => void;
}): JSX.Element | null {
  const [index, setIndex] = useState(0);
  const card = cards[index];
  if (card === undefined) return null;
  const next = (): void => {
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
        <h2 id="sc-ask-title" className="sc-ask__question">
          {card.question}
        </h2>
        <p className="sc-ask__context">{card.context}</p>
        <div className={card.layout === 'rows' ? 'sc-ask__rows' : 'sc-ask__buttons'}>
          {card.answers.map((answer) =>
            card.layout === 'rows' ? (
              <button
                key={answer.id}
                type="button"
                className="sc-ask__row"
                onClick={() => {
                  onAnswer(card.id, answer.id);
                  next();
                }}
              >
                <b>{answer.label}</b>
                <span>{answer.text}</span>
              </button>
            ) : (
              <button
                key={answer.id}
                type="button"
                className="nv-btn nv-btn--soft sc-ask__btn"
                onClick={() => {
                  onAnswer(card.id, answer.id);
                  next();
                }}
              >
                {answer.label}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className="nv-btn nv-btn--plain sc-ask__later"
          onClick={() => {
            onLater(card.id);
            next();
          }}
        >
          Plus tard
        </button>
      </div>
    </section>
  );
}
