import type {
  FanCardEntry,
  FanCardField,
  FanCardFieldSpec,
  FanCardValue,
  SetFanCardFieldBody,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { FanCardRefused, fanCardKey, setFanCardField, useFanCard } from './api';
import {
  CARD_GROUPS,
  CLOSED_CHOICES,
  editText,
  entryOf,
  essentialSpecs,
  fieldsOf,
  groupLine,
  isClosed,
  itemsOf,
  itemsProblem,
  sourceLine,
  toCheckWords,
  valueText,
} from './model';

import './fan-card.css';

type Write = (field: FanCardField, body: SetFanCardFieldBody) => Promise<boolean>;

/**
 * What is known of him (ADR 0085, lot c), under his limits in the fan's sheet: three folded groups, each line says how
 * full it is and what waits for a chatter. A value says where it comes from and how old it is; a chatter corrects,
 * adds or clears a field in one gesture, and keeps one value or the other where the AI read something else (§ 6).
 * Never shown to a creator (ADR 0063): the sheet does not render it for her.
 */
export function FanCard({ creatorId, fanId }: { creatorId: string; fanId: string }): JSX.Element | null {
  const card = useFanCard(creatorId, fanId, true);
  const client = useQueryClient();
  const [pending, setPending] = useState<FanCardField | null>(null);
  const [refusal, setRefusal] = useState<{ field: FanCardField; message: string } | null>(null);

  if (card.data === undefined) {
    if (card.isPending) return null;
    return (
      <p className="tr-learn">
        <span className="tr-learn__title">Ce qu’on sait de lui</span>
        <span className="tr-learn__slots">
          {card.error instanceof FanCardRefused ? 'Fiche non lisible pour toi.' : 'Le serveur ne répond pas.'}
        </span>
      </p>
    );
  }
  const view = card.data;
  const now = new Date();

  const write: Write = async (field, body) => {
    setPending(field);
    setRefusal(null);
    const change = await setFanCardField(creatorId, fanId, field, body);
    setPending(null);
    if (change.ok) {
      client.setQueryData(fanCardKey(creatorId, fanId), change.view);
      return true;
    }
    setRefusal({ field, message: change.message });
    return false;
  };

  const row = (spec: FanCardFieldSpec): JSX.Element => (
    <FieldRow
      key={spec.field}
      spec={spec}
      entry={entryOf(view.fields, spec.field)}
      now={now}
      pending={pending !== null}
      refusal={refusal?.field === spec.field ? refusal.message : null}
      write={write}
    />
  );

  return (
    <>
      {/* What a chatter needs at a glance stays unfolded on top (ADR 0086 § 10, Charles 08/11). */}
      <ul className="tr-card__fields tr-card__essentials" aria-label="L’essentiel">
        {essentialSpecs().map(row)}
      </ul>
      {CARD_GROUPS.map(({ group, title }) => {
        const line = groupLine(view.fields, group);
        return (
          <details key={group} className="tr-limits tr-card">
            <summary>
              <span className="tr-limits__title">{title}</span>
              <span className="tr-limits__sum">
                {line.toCheck === 0 ? null : <span className="tr-warn">{toCheckWords(line.toCheck)} · </span>}
                {line.filled}
              </span>
            </summary>
            <ul className="tr-card__fields">{fieldsOf(group).map(row)}</ul>
          </details>
        );
      })}
      {view.others.length === 0 ? null : (
        <details className="tr-limits tr-card">
          <summary>
            <span className="tr-limits__title">Autres</span>
            <span className="tr-limits__sum">{String(view.others.length)}</span>
          </summary>
          <ul className="tr-card__fields">
            {view.others.map((other) => (
              <li key={`${other.key}-${other.observedAt}`} className="tr-card__field">
                <p className="tr-card__value">{other.value}</p>
                <p className="tr-card__source">{sourceLine({ ...other, notedByName: null }, now)}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function FieldRow({
  spec,
  entry,
  now,
  pending,
  refusal,
  write,
}: {
  spec: FanCardFieldSpec;
  entry: FanCardEntry;
  now: Date;
  pending: boolean;
  refusal: string | null;
  write: Write;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const { current, toCheck } = entry;
  const items = itemsOf(text, spec.shape);
  const problem = itemsProblem(items);
  const stop = (): void => {
    setEditing(false);
    setText('');
  };
  const save = (): void => {
    if (problem !== null) return;
    void write(spec.field, { items }).then((ok) => {
      if (ok) stop();
    });
  };
  const closed = isClosed(spec.field);
  // Said only when there is something to say: an empty line would push the buttons away from the field.
  const hint = problem ?? (spec.shape === 'list' ? 'Un élément par ligne.' : null);

  return (
    <li className="tr-card__field">
      <div className="tr-card__head">
        <span className="tr-card__label">
          {spec.label}
          {spec.hint === undefined ? null : <span className="tr-card__hint"> · {spec.hint}</span>}
        </span>
        {editing || closed ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            disabled={pending}
            onClick={() => {
              setText(current === null ? '' : editText(current.items));
              setEditing(true);
            }}
          >
            {current === null ? 'Ajouter' : 'Corriger'}
          </button>
        )}
        {closed && current !== null ? (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            disabled={pending}
            onClick={() => void write(spec.field, { clear: true })}
          >
            Effacer
          </button>
        ) : null}
      </div>

      {isClosed(spec.field) ? (
        <div className="tr-card__choices" role="radiogroup" aria-label={spec.label}>
          {CLOSED_CHOICES[spec.field].map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={current?.items[0] === choice.value}
              disabled={pending}
              onClick={() => {
                if (current?.items[0] !== choice.value) void write(spec.field, { items: [choice.value] });
              }}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : editing ? (
        <div className="tr-card__edit">
          {spec.shape === 'one' ? (
            <input
              // « Corriger » is gone once clicked: the keyboard lands in the field.
              autoFocus
              className="nv-field__control tr-card__input"
              aria-label={spec.label}
              value={text}
              disabled={pending}
              onChange={(event) => {
                setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save();
                if (event.key === 'Escape') stop();
              }}
            />
          ) : (
            <textarea
              autoFocus
              className="nv-field__control tr-card__input"
              aria-label={spec.label}
              aria-describedby={hint === null ? undefined : `tr-card-${spec.field}-hint`}
              rows={Math.max(2, text.split('\n').length + 1)}
              value={text}
              disabled={pending}
              onChange={(event) => {
                setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') stop();
              }}
            />
          )}
          {hint === null ? null : (
            <span className="tr-card__hint" id={`tr-card-${spec.field}-hint`}>
              {hint}
            </span>
          )}
          <span className="tr-limit__actions">
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              disabled={pending || problem !== null}
              onClick={save}
            >
              Enregistrer
            </button>
            {current === null ? null : (
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={pending}
                onClick={() =>
                  void write(spec.field, { clear: true }).then((ok) => {
                    if (ok) stop();
                  })
                }
              >
                Effacer
              </button>
            )}
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={pending}
              onClick={stop}
            >
              Annuler
            </button>
          </span>
        </div>
      ) : current === null ? (
        <p className="tr-card__empty">
          {spec.learning === 'observe' ? 'Pas encore deviné' : 'Pas encore su'}
        </p>
      ) : (
        <p className="tr-card__value">{valueText(spec.field, current.items)}</p>
      )}

      {current === null || editing ? null : (
        <>
          <p className="tr-card__source">{sourceLine(current, now)}</p>
          <Quote value={current} />
        </>
      )}

      {toCheck.length === 0 ? null : (
        <div className="tr-card__check" role="group" aria-label={`${spec.label} : à vérifier`}>
          <p className="tr-card__check-title">À vérifier : l’agent a lu autre chose</p>
          {toCheck.map((value) => (
            <div key={value.observedAt} className="tr-card__check-row">
              <span className="tr-card__check-text">
                « {valueText(spec.field, value.items)} »
                <span className="tr-card__source"> {sourceLine(value, now)}</span>
                <Quote value={value} />
              </span>
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                disabled={pending}
                onClick={() => void write(spec.field, { items: value.items })}
              >
                Garder celle-ci
              </button>
            </div>
          ))}
          {current === null ? null : (
            <div className="tr-card__check-row">
              <span className="tr-card__check-text">« {valueText(spec.field, current.items)} »</span>
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={pending}
                onClick={() => void write(spec.field, { items: current.items })}
              >
                Garder la note
              </button>
            </div>
          )}
        </div>
      )}

      {refusal === null ? null : (
        <p className="tr-card__refusal tr-warn" role="alert">
          {refusal}
        </p>
      )}
    </li>
  );
}

/** His words a value rests on (ADR 0085 § 5): shown as his, never read as an instruction; nothing when there are none. */
function Quote({ value }: { value: FanCardValue }): JSX.Element | null {
  if (value.sourceQuote === null) return null;
  return (
    <span className="tr-card__quote">
      Il a écrit : <q>{value.sourceQuote}</q>
    </span>
  );
}
