import type { CreatorId } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { ScriptReview } from './ScriptReview';
import { archiveHref, confirmCopied, contentKey, useCreatorContent } from './api';
import {
  BLOCKER_TEXTS,
  MOMENT_EMOJIS,
  MOMENT_LABELS,
  dayLabel,
  mediaLine,
  sentScripts,
  type SentScriptRow,
} from './model';
import { SWITCH_FAILED, setDescribeSwitch, switchKey, useDescribeSwitch } from './review-api';
import './scripts.css';

import { useStructures } from '@/scripts/api';
import { Dialog } from '@/shell/Dialog';
import '@/creators/agenda/agency-agenda.css';

/**
 * Créatrices › Scripts (SC-03 c2b, ADR 0056 § 7), the owner's and an active manager's: each script she sent, its
 * archive to download (the sheet first, then each card and each medium in the script's order) and « Copié dans
 * Reveal » once the team has copied it: her originals of it go 30 days later (ADR 0044 § 2).
 */
export function ScriptsSection({
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
  const structures = useStructures();
  const [confirming, setConfirming] = useState<SentScriptRow | null>(null);

  const list = (): JSX.Element => {
    if (content.data === undefined) {
      if (content.isError)
        return (
          <div className="nv-plate aa-empty">
            <p className="aa-empty__title">Ses scripts ne se chargent pas</p>
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
    const rows = sentScripts(content.data, structures.data ?? []);
    if (rows.length === 0)
      return (
        <div className="nv-plate aa-empty">
          <p className="aa-empty__title">Aucun script envoyé</p>
          <p className="ps-muted">
            Quand {creatorName} envoie un script depuis son téléphone, il arrive ici avec son numéro, prêt à
            être recopié dans Reveal.
          </p>
        </div>
      );
    // Only what can be copied now counts: a script being checked or without an archive is not « à recopier ».
    const toCopy = rows.filter((row) => row.exportedAt === null && row.blocker === null);
    const waiting = toCopy.length;
    const pending = rows.filter((row) => row.exportedAt === null).length;
    return (
      <>
        <p className="aa-summary nv-num">
          {rows.length === 1 ? '1 script' : `${String(rows.length)} scripts`}
          {waiting > 0
            ? ` · ${String(waiting)} à recopier`
            : pending === 0
              ? ' · tous copiés dans Reveal'
              : ' · aucun à recopier pour l’instant'}
        </p>
        <ul className="sx-list">
          {rows.map((row, index) => (
            <ScriptCard
              key={row.dropId}
              row={row}
              index={index}
              creatorId={creatorId}
              timezone={timezone}
              // One neon per screen: the next script to copy carries it, the others say the same thing softly.
              leading={row.dropId === toCopy[0]?.dropId}
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
    <section className="ps-page aa-page sx-page" aria-label={`Scripts de ${creatorName}`}>
      <div className="nv-plate ps-head">
        <div className="ps-head__top">
          <div className="ps-head__who">
            <p className="ps-title">Ses scripts</p>
            <p className="ps-muted">
              Les scripts envoyés par {creatorName}, le plus récent d’abord. Télécharge l’archive, recopie-la
              dans Reveal en suivant la fiche, puis confirme la copie.
            </p>
          </div>
        </div>
      </div>
      {isOwner ? <DescribeSwitch creatorId={creatorId} creatorName={creatorName} /> : null}
      {list()}
      {confirming === null ? null : (
        <ConfirmCopy
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

function stateOf(row: SentScriptRow): {
  readonly label: string;
  readonly tone: 'ok' | 'warn' | 'wait' | 'todo';
} {
  if (row.exportedAt !== null) return { label: 'Copié dans Reveal', tone: 'ok' };
  if (row.blocker === 'not_ready') return { label: 'En vérification', tone: 'wait' };
  if (row.blocker !== null) return { label: 'Archive impossible', tone: 'warn' };
  return { label: 'À recopier', tone: 'todo' };
}

function ScriptCard({
  row,
  index,
  creatorId,
  timezone,
  leading,
  onConfirm,
}: {
  row: SentScriptRow;
  index: number;
  creatorId: CreatorId;
  timezone: string;
  leading: boolean;
  onConfirm: () => void;
}): JSX.Element {
  const id = useId();
  const state = stateOf(row);
  const [reviewing, setReviewing] = useState(false);
  return (
    <li
      className="nv-plate sx-card nv-enter"
      style={{ '--nv-i': index + 1 }}
      data-exported={row.exportedAt !== null}
      aria-labelledby={`${id}-title`}
    >
      <div className="sx-card__top">
        <span className="sx-code nv-num">{row.code}</span>
        {row.moment === null ? null : (
          <span className="sx-moment">
            <span aria-hidden="true">{MOMENT_EMOJIS[row.moment]}</span>
            {MOMENT_LABELS[row.moment]}
          </span>
        )}
        <span className="aa-pill sx-state" data-tone={state.tone}>
          {state.label}
        </span>
      </div>
      <div className="sx-card__body">
        <h3 id={`${id}-title`} className="sx-title">
          {row.name ?? 'Structure retirée de la bibliothèque'}
        </h3>
        <p className="sx-meta nv-num">
          Envoyé le {dayLabel(row.sentAt, timezone)} · {mediaLine(row)}
        </p>
      </div>
      {row.exportedAt !== null && row.originalsUntil !== null ? (
        <p className="sx-note nv-num">
          Copié le {dayLabel(row.exportedAt, timezone)}. Ses originaux partent au plus tard le{' '}
          {dayLabel(row.originalsUntil, timezone)}.
        </p>
      ) : row.blocker === null ? null : (
        <p className="sx-note" data-tone={row.blocker === 'not_ready' ? undefined : 'warn'}>
          {BLOCKER_TEXTS[row.blocker]}
        </p>
      )}
      <div className="sx-actions">
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
      </div>
      {reviewing ? (
        <div id={`${id}-review`}>
          <ScriptReview creatorId={creatorId} dropId={row.dropId} code={row.code} />
        </div>
      ) : null}
      {row.blocker === null ? (
        <div className="sx-actions">
          <a
            className={`nv-btn nv-btn--sm ${row.exportedAt === null ? 'nv-btn--soft' : 'nv-btn--plain'}`}
            href={archiveHref(creatorId, row.dropId)}
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
              Copié dans Reveal
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

const AFTER_EXPORT_MS = 30 * 86_400_000;

function ConfirmCopy({
  row,
  creatorId,
  timezone,
  onClose,
}: {
  row: SentScriptRow;
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
    const outcome = await confirmCopied(creatorId, row.dropId);
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
      title="Copié dans Reveal ?"
      lead={`${row.code} · ${row.name ?? 'Structure retirée de la bibliothèque'}`}
      busy={busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        <p className="sx-dialog__text">
          Confirme une fois le dossier recopié en entier dans Reveal, chaque étape à sa place, la fiche suivie
          jusqu’au bout.
        </p>
        <p className="sx-dialog__text nv-num">
          Ses originaux de ce script partent alors dans 30{'\u00a0'}jours, au plus tard le {until}. La
          confirmation ne se retire pas.
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
            {busy ? 'Confirmation…' : 'Confirmer la copie'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Her switch of the descriptions (ADR 0083 § 9), the owner's: on, each photo and video she drops is described by the
 * vision AI, then read again here before any use; what she dropped while it was off is described at once.
 */
function DescribeSwitch({
  creatorId,
  creatorName,
}: {
  creatorId: CreatorId;
  creatorName: string;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const current = useDescribeSwitch(creatorId, true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const turn = async (on: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    const answer = await setDescribeSwitch(creatorId, on);
    setBusy(false);
    if (answer === null) {
      setError(SWITCH_FAILED);
      return;
    }
    client.setQueryData(switchKey(creatorId), answer);
  };

  return (
    <div className="nv-plate sx-switch">
      <div className="sx-switch__text">
        <label className="sx-switch__title" htmlFor={id}>
          Descriptions par l’IA
        </label>
        <p className="ps-muted">
          {current.data === true
            ? `Chaque photo et vidéo de ${creatorName} est décrite à son arrivée, puis relue ici avant tout usage.`
            : `Éteint : ses médias ne sont pas décrits. Allumé, ce qu’elle a déjà déposé l’est aussi.`}
        </p>
        {error === null ? null : (
          <p className="sx-error nv-swap" role="alert">
            {error}
          </p>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="nv-switch"
        checked={current.data === true}
        disabled={busy || current.data === undefined}
        aria-busy={busy}
        onChange={(event) => {
          void turn(event.target.checked);
        }}
      />
    </div>
  );
}
