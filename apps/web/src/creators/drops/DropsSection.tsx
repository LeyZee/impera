import type { CreatorId } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { confirmOut, dropArchiveHref } from './api';
import { OUT_LABELS, OUT_PLACES, herDrops, holdsLine, summaryLine, type HerDropRow } from './model';

import { DescribeSwitch } from '@/creators/scripts/DescribeSwitch';
import { ScriptReview } from '@/creators/scripts/ScriptReview';
import { contentKey, useCreatorContent } from '@/creators/scripts/api';
import { dayLabel } from '@/creators/scripts/model';
import '@/creators/scripts/scripts.css';
import { Dialog } from '@/shell/Dialog';
import '@/creators/agenda/agency-agenda.css';

/**
 * Créatrices › Contenu (recette créatrice 1 et 6), the owner's and an active manager's: every drop of hers but a
 * script, her media, their descriptions to read, its archive and « Publié » once the team put it out by hand (ADR 0044):
 * her originals of it go 30 days later. The switch of the descriptions stands here, at the head of what it describes.
 */
export function DropsSection({
  creatorId,
  creatorName,
  timezone,
  isOwner = false,
}: {
  creatorId: CreatorId;
  creatorName: string;
  timezone: string;
  /** Her switch of the descriptions is the owner's alone (ADR 0083 § 9). */
  isOwner?: boolean;
}): JSX.Element {
  const content = useCreatorContent(creatorId);
  const [confirming, setConfirming] = useState<HerDropRow | null>(null);

  const list = (): JSX.Element => {
    if (content.data === undefined) {
      if (content.isError)
        return (
          <div className="nv-plate aa-empty">
            <p className="aa-empty__title">Son contenu ne se charge pas</p>
            <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft ps-self-start"
              onClick={() => void content.refetch()}
            >
              Réessayer
            </button>
          </div>
        );
      return <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" aria-busy="true" />;
    }
    const rows = herDrops(content.data);
    if (rows.length === 0)
      return (
        <div className="nv-plate aa-empty">
          <p className="aa-empty__title">Aucun dépôt</p>
          <p className="ps-muted">
            Quand {creatorName} dépose une séance, une story ou une relance depuis son téléphone, elle arrive
            ici avec ses médias et leurs descriptions. Ses scripts ont leur onglet.
          </p>
        </div>
      );
    const first = rows.find((row) => row.standing === 'to_publish');
    return (
      <>
        <p className="aa-summary nv-num">{summaryLine(rows)}</p>
        <ul className="sx-list">
          {rows.map((row, index) => (
            <DropCard
              key={row.dropId}
              row={row}
              index={index}
              creatorId={creatorId}
              timezone={timezone}
              // One neon per screen: the next drop to put out carries it.
              leading={row.dropId === first?.dropId}
              onConfirm={() => {
                setConfirming(row);
              }}
            />
          ))}
        </ul>
      </>
    );
  };

  return (
    <section className="ps-page aa-page sx-page" aria-label={`Contenu de ${creatorName}`}>
      <div className="nv-plate ps-head">
        <div className="ps-head__top">
          <div className="ps-head__who">
            <p className="ps-title">Son contenu</p>
            <p className="ps-muted">
              Ce que {creatorName} dépose hors scripts, le plus récent d’abord{'\u00a0'}: relis les
              descriptions, télécharge l’archive, publie-la à la main, puis confirme.
            </p>
          </div>
        </div>
      </div>
      {isOwner ? <DescribeSwitch creatorId={creatorId} creatorName={creatorName} /> : null}
      {list()}
      {confirming === null ? null : (
        <ConfirmOut
          row={confirming}
          creatorId={creatorId}
          timezone={timezone}
          onClose={() => {
            setConfirming(null);
          }}
        />
      )}
    </section>
  );
}

function stateOf(row: HerDropRow): {
  readonly label: string;
  readonly tone: 'ok' | 'warn' | 'wait' | 'todo';
} {
  switch (row.standing) {
    case 'out':
      return { label: OUT_LABELS[row.category], tone: 'ok' };
    case 'checking':
      return { label: 'En vérification', tone: 'wait' };
    case 'blocked':
      return { label: 'Bloqué', tone: 'warn' };
    case 'too_large':
      return { label: 'Archive impossible', tone: 'warn' };
    case 'to_publish':
      return { label: 'À publier', tone: 'todo' };
  }
}

function DropCard({
  row,
  index,
  creatorId,
  timezone,
  leading,
  onConfirm,
}: {
  row: HerDropRow;
  index: number;
  creatorId: CreatorId;
  timezone: string;
  leading: boolean;
  onConfirm: () => void;
}): JSX.Element {
  const id = useId();
  const state = stateOf(row);
  const [reviewing, setReviewing] = useState(false);
  const settled = row.standing === 'to_publish' || row.standing === 'out';
  const holds = row.photos + row.videos + row.vocals > 0;
  return (
    <li
      className="nv-plate sx-card nv-enter"
      style={{ '--nv-i': index + 1 }}
      data-exported={row.exportedAt !== null}
      aria-labelledby={`${id}-title`}
    >
      <div className="sx-card__top">
        <span className="aa-pill sx-state" data-tone={state.tone}>
          {state.label}
        </span>
      </div>
      <div className="sx-card__body">
        <h3 id={`${id}-title`} className="sx-title">
          {row.label}
        </h3>
        <p className="sx-meta nv-num">
          Déposé le {dayLabel(row.sentAt, timezone)} · {holdsLine(row)}
        </p>
        {row.sentence === null ? null : <p className="sx-meta">« {row.sentence} »</p>}
      </div>
      {row.exportedAt !== null && row.originalsUntil !== null ? (
        <p className="sx-note nv-num">
          Confirmé le {dayLabel(row.exportedAt, timezone)}. Ses originaux partent au plus tard le{' '}
          {dayLabel(row.originalsUntil, timezone)}.
        </p>
      ) : row.standing === 'checking' ? (
        <p className="sx-note">
          Ses médias sont encore vérifiés : l’archive arrive dès qu’ils sont tous gardés.
        </p>
      ) : row.standing === 'blocked' ? (
        <p className="sx-note" data-tone="warn">
          {row.blockedReason ?? 'Aucun fichier de ce dépôt n’a pu être gardé.'}
        </p>
      ) : row.standing === 'too_large' ? (
        <p className="sx-note" data-tone="warn">
          Ses médias pèsent plus de 4{' '}Go : ils ne tiennent pas dans une seule archive.
        </p>
      ) : null}
      <div className="sx-actions">
        {/* Nothing kept, nothing to read: a blocked drop says why above, and holds no description. */}
        {holds ? (
          <button
            type="button"
            className="nv-btn nv-btn--sm nv-btn--plain"
            aria-expanded={reviewing}
            aria-controls={`${id}-review`}
            onClick={() => {
              setReviewing((open) => !open);
            }}
          >
            {reviewing ? 'Fermer les descriptions' : 'Relire les descriptions'}
          </button>
        ) : null}
        {settled ? (
          <>
            <a
              className={`nv-btn nv-btn--sm ${row.exportedAt === null ? 'nv-btn--soft' : 'nv-btn--plain'}`}
              href={dropArchiveHref(creatorId, row.dropId)}
              download
            >
              {row.exportedAt === null ? 'Télécharger l’archive' : 'Télécharger à nouveau'}
            </a>
            {row.exportedAt === null ? (
              <button
                type="button"
                className={`nv-btn nv-btn--sm ${leading ? 'nv-btn--neon' : 'nv-btn--soft'}`}
                onClick={onConfirm}
              >
                {OUT_LABELS[row.category]}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {reviewing && holds ? (
        <div id={`${id}-review`}>
          <ScriptReview creatorId={creatorId} dropId={row.dropId} code={row.label} />
        </div>
      ) : null}
    </li>
  );
}

const AFTER_EXPORT_MS = 30 * 86_400_000;

function ConfirmOut({
  row,
  creatorId,
  timezone,
  onClose,
}: {
  row: HerDropRow;
  creatorId: CreatorId;
  timezone: string;
  onClose: () => void;
}): JSX.Element {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const until = dayLabel(new Date(Date.now() + AFTER_EXPORT_MS).toISOString(), timezone);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const outcome = await confirmOut(creatorId, row.dropId);
    if (outcome.kind === 'ok') {
      await client.invalidateQueries({ queryKey: contentKey(creatorId) });
      setBusy(false);
      onClose();
      return;
    }
    setBusy(false);
    setError(outcome.message);
  };

  return (
    <Dialog
      title={`${OUT_LABELS[row.category]} ?`}
      lead={`${row.label} · déposé le ${dayLabel(row.sentAt, timezone)}`}
      busy={busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        <p className="sx-dialog__text">
          Confirme une fois le dépôt {OUT_PLACES[row.category]}, chaque média à sa place, dans l’ordre de
          l’archive.
        </p>
        <p className="sx-dialog__text nv-num">
          Ses originaux partent alors dans 30{' '}jours, au plus tard le {until}. La confirmation ne se retire
          pas.
        </p>
        {error === null ? null : (
          <p className="sx-error nv-swap" role="alert">
            {error}
          </p>
        )}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--neon"
            disabled={busy}
            data-autofocus
            onClick={() => void confirm()}
          >
            {busy ? 'Confirmation…' : 'Confirmer'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
