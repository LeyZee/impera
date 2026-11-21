import {
  AnswerToAgencyMessageBodySchema,
  CREATOR_MESSAGE_TEXT_MAX,
  type WaitingToAgencyMessage,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { useGrowingArea } from '@/lib/growing-area';
import { NOT_SENT } from '@/screens/agenda/api';
import { answerMessage, readWaitingAgain } from '@/screens/today/to-agency/api';
import { answerRefusal, kindWords, waitingSince } from '@/screens/today/to-agency/model';
import '@/screens/today/to-agency/to-agency.css';

/**
 * « Écrire à l'agence » on the agency's side (trous béants n° 13), inside « À faire »: each message a creator wrote
 * and nobody answered yet, the oldest first, with its answer box for the owner; an active manager reads them.
 */
export function MessagesTodo({
  messages,
  canAnswer,
}: {
  messages: readonly WaitingToAgencyMessage[];
  canAnswer: boolean;
}): JSX.Element | null {
  if (messages.length === 0) return null;
  return (
    <div className="ta-todo">
      <p className="ta-todo__title">
        {messages.length === 1
          ? 'Une créatrice t’a écrit'
          : `Tes créatrices t’ont écrit ${String(messages.length)} fois`}
      </p>
      <ul className="ta-list">
        {messages.map((message) => (
          <li key={message.id} className="ta-item">
            <div className="ta-item__top">
              <span className="ta-todo__who">
                <b>{message.creatorName}</b>
                <span className="ta-kind" data-kind={message.kind}>
                  {kindWords(message.kind)}
                </span>
              </span>
              <span className="ta-item__on nv-num">{waitingSince(message.createdAt, new Date())}</span>
            </div>
            <p className="ta-item__body">{message.body}</p>
            {canAnswer ? (
              <AnswerBox message={message} />
            ) : (
              <p className="ta-item__waiting">Le propriétaire répond.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerBox({ message }: { message: WaitingToAgencyMessage }): JSX.Element {
  const client = useQueryClient();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const area = useGrowingArea(text);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const body = AnswerToAgencyMessageBodySchema.safeParse({ answer: text });
  if (!open)
    return (
      <div className="ta-actions">
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          onClick={() => {
            setOpen(true);
          }}
        >
          Répondre
        </button>
      </div>
    );
  return (
    <form
      className="ta-form"
      aria-label={`Répondre à ${message.creatorName}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.success) return;
        setBusy(true);
        void answerMessage(message.creatorId, message.id, body.data.answer)
          .then(async (outcome) => {
            if (outcome.kind === 'ok') {
              setFailed(null);
              await readWaitingAgain(client);
            } else
              setFailed(outcome.kind === 'refused' ? answerRefusal(outcome.code) : NOT_SENT[outcome.kind]);
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <div className="nv-field">
        <label className="nv-field__label" htmlFor={`${id}-answer`}>
          Ta réponse, qu’elle lira sur son accueil
        </label>
        <textarea
          ref={area}
          id={`${id}-answer`}
          className="nv-field__control nv-glass grow-area ta-body"
          value={text}
          rows={3}
          maxLength={CREATOR_MESSAGE_TEXT_MAX}
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
        <button type="submit" className="nv-btn nv-btn--neon nv-btn--sm" disabled={busy || !body.success}>
          Envoyer la réponse
        </button>
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          onClick={() => {
            setOpen(false);
          }}
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
