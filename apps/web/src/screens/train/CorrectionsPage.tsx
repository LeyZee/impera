import {
  DRAFT_CORRECTION_REASON_LABELS,
  DRAFT_CORRECTIONS_DAYS,
  type DraftCorrection,
  type DraftCorrectionReason,
} from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type JSX } from 'react';

import { correctionsError, useDraftCorrections } from './corrections/api';

import { useCreators } from '@/creators/api';
import { Select, type SelectOption } from '@/shell/Select';

import './corrections/corrections.css';

/**
 * Entraîner › Corrections (trou béant 12, recette du 21/11): the drafts a human refused or retouched in her real
 * conversations, by reason, what the agent wrote beside what left. The owner's alone (ADR 0092 § 8). Read only: what
 * to change goes through the Playground and her persona.
 */
export function CorrectionsPage(): JSX.Element {
  const creators = useCreators();
  const [creatorId, setCreatorId] = useState('');
  const list = creators.data ?? [];
  useEffect(() => {
    const first = list[0];
    if (creatorId === '' && first !== undefined) setCreatorId(first.id);
  }, [creatorId, list]);

  if (creators.isPending) return <p className="co-state">Chargement…</p>;
  if (creators.isError) return <p className="co-state">{correctionsError(creators.error)}</p>;
  if (list.length === 0) return <p className="co-state">Aucune créatrice : ajoute-la dans Créatrices.</p>;
  const options: SelectOption<string>[] = list.map((one) => ({ value: one.id, label: one.displayName }));
  return (
    <div className="co-page">
      <div className="co-creator">
        <Select<string> ariaLabel="Créatrice" value={creatorId} options={options} onChange={setCreatorId} />
      </div>
      {creatorId === '' ? null : <CreatorCorrections key={creatorId} creatorId={creatorId} />}
    </div>
  );
}

function CreatorCorrections({ creatorId }: { creatorId: string }): JSX.Element {
  const corrections = useDraftCorrections(creatorId);
  const [reason, setReason] = useState<DraftCorrectionReason | null>(null);

  if (corrections.isPending) return <p className="co-state">Chargement…</p>;
  if (corrections.isError) return <p className="co-state">{correctionsError(corrections.error)}</p>;
  const view = corrections.data;
  if (view.items.length === 0) {
    return (
      <p className="co-state">
        Aucun brouillon refusé ni retouché depuis {String(DRAFT_CORRECTIONS_DAYS)} jours.
      </p>
    );
  }
  const shown = reason === null ? view.items : view.items.filter((item) => item.reason === reason);
  return (
    <>
      <div className="co-reasons" role="group" aria-label="Raisons">
        <button
          type="button"
          className="nv-chip"
          aria-pressed={reason === null}
          onClick={() => {
            setReason(null);
          }}
        >
          Toutes · {String(view.items.length)}
        </button>
        {view.counts.map((one) => (
          <button
            key={one.reason}
            type="button"
            className="nv-chip"
            aria-pressed={reason === one.reason}
            onClick={() => {
              setReason(one.reason);
            }}
          >
            {DRAFT_CORRECTION_REASON_LABELS[one.reason]} · {String(one.count)}
          </button>
        ))}
      </div>
      <p className="co-lead">
        Ses {String(DRAFT_CORRECTIONS_DAYS)} derniers jours
        {view.truncated ? `, les ${String(view.items.length)} plus récentes` : ''}.
      </p>
      <ul className="co-list">
        {shown.map((item) => (
          <CorrectionCard key={`${item.draftId}-${item.kind}`} creatorId={creatorId} item={item} />
        ))}
      </ul>
    </>
  );
}

const WHEN = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** One draft: why, then what the agent wrote beside what left (nothing left for a refusal). */
function CorrectionCard({ creatorId, item }: { creatorId: string; item: DraftCorrection }): JSX.Element {
  return (
    <li className="nv-plate nv-plate--pad co-card">
      <div className="co-card__head">
        <span className="co-card__reason">{DRAFT_CORRECTION_REASON_LABELS[item.reason]}</span>
        <span className="co-card__meta">
          <Link to="/suivi" search={{ conversation: item.conversationId, creatrice: creatorId }}>
            {item.fanDisplayName === '' ? 'Sa conversation' : item.fanDisplayName}
          </Link>
          {' · '}
          {WHEN.format(new Date(item.at))}
        </span>
      </div>
      {item.note === null ? null : <p className="co-card__note">« {item.note} »</p>}
      <div className="co-card__sides">
        <section className="co-side" aria-label="Avant">
          <h3 className="nv-eyebrow co-side__title">L’agent avait écrit</h3>
          {item.before.map((bubble, index) => (
            <p key={index} className="co-side__bubble">
              {bubble}
            </p>
          ))}
        </section>
        <section className="co-side" aria-label="Après">
          <h3 className="nv-eyebrow co-side__title">
            {item.kind === 'edited' ? 'Parti à la place' : 'Refusé'}
          </h3>
          {item.after === null ? (
            <p className="co-side__none">Rien n’est parti de ce brouillon.</p>
          ) : (
            item.after.map((bubble, index) => (
              <p key={index} className="co-side__bubble">
                {bubble}
              </p>
            ))
          )}
        </section>
      </div>
    </li>
  );
}
