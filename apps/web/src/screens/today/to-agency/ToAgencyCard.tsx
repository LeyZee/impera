import {
  CREATOR_MESSAGE_KINDS,
  CREATOR_MESSAGE_TEXT_MAX,
  NewToAgencyMessageBodySchema,
  type ToAgencyMessageKind,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { readMineAgain, useMyMessages, writeToAgency } from './api';
import { kindWords, messageLines } from './model';
import './to-agency.css';

import { useGrowingArea } from '@/lib/growing-area';
import { NOT_SENT } from '@/screens/agenda/api';

/**
 * « Écrire à l'agence » (Charles, 21/11, trous béants n° 13): a question, an idea or a worry, in her words; it waits
 * in the owner's « À faire » and his answer comes back here, under what she wrote.
 */
export function ToAgencyCard(): JSX.Element | null {
  const client = useQueryClient();
  const read = useMyMessages();
  const [writing, setWriting] = useState(false);
  const [sent, setSent] = useState(false);
  if (read.data === undefined) return null;
  const lines = messageLines(read.data.messages);
  return (
    <section className="nv-plate ta-card nv-enter" aria-labelledby="ta-title">
      <div className="ta-head">
        <h2 id="ta-title" className="nv-h2 sc-fans__title">
          Écrire à l’agence
        </h2>
        <p className="ta-lead">Une question, une idée, un souci : on te répond ici.</p>
      </div>
      {lines.length === 0 ? null : (
        <ul className="ta-list">
          {lines.map((line) => (
            <li key={line.id} className="ta-item" data-answered={line.answer === null ? undefined : true}>
              <div className="ta-item__top">
                <span className="ta-kind" data-kind={line.kindKey}>
                  {line.kind}
                </span>
                <span className="ta-item__on nv-num">{line.on}</span>
              </div>
              <p className="ta-item__body">{line.body}</p>
              {line.answer === null ? (
                <p className="ta-item__waiting">En attente de réponse</p>
              ) : (
                <p className="ta-item__answer">
                  <b>L’agence :</b> {line.answer}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {sent ? (
        <p className="ta-told" role="status">
          C’est parti. On te répond ici.
        </p>
      ) : null}
      {writing ? (
        <MessageForm
          onCancel={() => {
            setWriting(false);
          }}
          onSent={async () => {
            setWriting(false);
            setSent(true);
            await readMineAgain(client);
          }}
        />
      ) : (
        <div className="ta-actions">
          <button
            type="button"
            className="nv-btn nv-btn--soft"
            onClick={() => {
              setSent(false);
              setWriting(true);
            }}
          >
            Écrire à l’agence
          </button>
        </div>
      )}
    </section>
  );
}

function MessageForm({
  onCancel,
  onSent,
}: {
  onCancel: () => void;
  onSent: () => Promise<void>;
}): JSX.Element {
  const id = useId();
  const [key] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<ToAgencyMessageKind>('question');
  const [text, setText] = useState('');
  const area = useGrowingArea(text);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const body = NewToAgencyMessageBodySchema.safeParse({ id: key, kind, body: text });
  const index = CREATOR_MESSAGE_KINDS.indexOf(kind);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next =
      CREATOR_MESSAGE_KINDS[(index + step + CREATOR_MESSAGE_KINDS.length) % CREATOR_MESSAGE_KINDS.length];
    if (next === undefined) return;
    setKind(next);
    group.current?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
  };
  return (
    <form
      className="ta-form"
      aria-label="Écrire à l’agence"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.success) return;
        setBusy(true);
        void writeToAgency(body.data)
          .then(async (outcome) => {
            if (outcome.kind === 'ok') {
              setFailed(null);
              await onSent();
            } else {
              setFailed(
                outcome.kind === 'refused'
                  ? 'Ton message n’a pas été pris. Réessaie.'
                  : NOT_SENT[outcome.kind],
              );
            }
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <span className="nv-field__label" id={`${id}-kind`}>
        C’est…
      </span>
      <div
        ref={group}
        className="nv-seg nv-glass nv-glass--thin ta-seg"
        role="radiogroup"
        aria-labelledby={`${id}-kind`}
        style={{ '--nv-seg-count': CREATOR_MESSAGE_KINDS.length, '--nv-seg-index': index }}
        onKeyDown={onKeyDown}
      >
        <span className="nv-seg__thumb nv-glass nv-glass--thin" aria-hidden="true" />
        {CREATOR_MESSAGE_KINDS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            className="nv-seg__opt"
            data-value={value}
            aria-checked={value === kind}
            tabIndex={value === kind ? 0 : -1}
            onClick={() => {
              setKind(value);
            }}
          >
            {kindWords(value)}
          </button>
        ))}
      </div>
      <div className="nv-field">
        <label className="nv-field__label" htmlFor={`${id}-body`}>
          Ton message
        </label>
        <textarea
          ref={area}
          id={`${id}-body`}
          className="nv-field__control nv-glass grow-area ta-body"
          value={text}
          rows={4}
          maxLength={CREATOR_MESSAGE_TEXT_MAX}
          placeholder="Ex. : une idée de tournage pour la semaine prochaine"
          data-autofocus
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>
      {failed === null ? null : (
        <p className="ta-failed" role="alert">
          {failed}
        </p>
      )}
      <div className="ta-actions">
        <button type="submit" className="nv-btn nv-btn--neon" disabled={busy || !body.success}>
          Envoyer
        </button>
        <button type="button" className="nv-btn nv-btn--plain" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
