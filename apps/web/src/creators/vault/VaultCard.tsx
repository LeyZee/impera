import type { CreatorId } from '@impera/contracts';
import { useEffect, useState, type JSX } from 'react';

import { askVaultSync, useVault } from './api';
import {
  SYNC_POLL_MS,
  folderRows,
  phaseAfterRead,
  phaseLine,
  polls,
  syncedLine,
  vaultFigures,
  type SyncPhase,
} from './model';
import './vault.css';

import { useNow } from '@/scheduling/useNow';

/** How many folders show before « Voir les N dossiers ». */
const FOLDERS_SHOWN = 5;

/**
 * « Son coffre Reveal » (ADR 0099 §§ 2-4), at the head of Créatrices › Scripts: when her vault was last read, what it
 * holds folder by folder, and for the owner alone « Synchroniser le coffre », the only thing that reads it again (no
 * cron). An active manager reads the card, never the button: a sync reads the platform with her session.
 */
export function VaultCard({
  creatorId,
  creatorName,
  isOwner,
}: {
  creatorId: CreatorId;
  creatorName: string;
  isOwner: boolean;
}): JSX.Element {
  const [phase, setPhase] = useState<SyncPhase>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const vault = useVault(creatorId, polls(phase) ? SYNC_POLL_MS : false);
  const now = useNow();

  // Each read of the vault while a sync is waited for: done once its date moves, « plus long que d'habitude » after.
  useEffect(() => {
    if (vault.data === undefined) return;
    const syncedAt = vault.data.syncedAt;
    setPhase((current) => phaseAfterRead(current, syncedAt, Date.now()));
  }, [vault.data, vault.dataUpdatedAt]);

  // « Coffre à jour. » says it, then leaves the room.
  useEffect(() => {
    if (phase.kind !== 'done') return;
    const timer = window.setTimeout(() => {
      setPhase({ kind: 'idle' });
    }, 6_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase.kind]);

  const sync = (): void => {
    const since = vault.data?.syncedAt ?? null;
    setPhase({ kind: 'asking' });
    void askVaultSync(creatorId).then((accounts) => {
      if (accounts === null) setPhase({ kind: 'failed' });
      else if (accounts === 0) setPhase({ kind: 'none' });
      else setPhase({ kind: 'waiting', since, askedAt: Date.now() });
    });
  };

  const running = phase.kind === 'asking' || phase.kind === 'waiting' || phase.kind === 'slow';
  const said = phaseLine(phase);

  const body = (): JSX.Element => {
    if (vault.data === undefined) {
      if (vault.isError)
        return (
          <div className="vx-empty">
            <p className="vx-empty__title">Son coffre ne se charge pas</p>
            <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm ps-self-start"
              onClick={() => void vault.refetch()}
            >
              Réessayer
            </button>
          </div>
        );
      return <div className="ps-skeleton vx-skeleton" aria-busy="true" />;
    }
    if (vault.data.syncedAt === null && vault.data.folders.length === 0)
      return (
        <div className="vx-empty">
          <p className="vx-empty__title">
            {isOwner ? 'Première synchro à lancer' : 'En attente de la première synchro'}
          </p>
          <p className="ps-muted">
            {isOwner
              ? `Lance une première synchro : Impera lit le coffre Reveal de ${creatorName}, dossier par dossier, sans rien y changer.`
              : `Le propriétaire lance la première synchro : le coffre Reveal de ${creatorName} apparaîtra ici.`}
          </p>
        </div>
      );
    if (vault.data.folders.length === 0)
      return (
        <div className="vx-empty">
          <p className="vx-empty__title">Coffre vide</p>
          <p className="ps-muted">Reveal n’a listé aucun média à la dernière synchro.</p>
        </div>
      );
    const figures = vaultFigures(vault.data);
    const rows = folderRows(vault.data);
    const shown = open ? rows : rows.slice(0, FOLDERS_SHOWN);
    return (
      <>
        <div className="nv-tiles vx-tiles">
          <div className="nv-tile">
            <span className="nv-tile__label">Médias</span>
            <span className="nv-tile__value nv-num">{figures.media}</span>
          </div>
          <div className="nv-tile">
            <span className="nv-tile__label">Dossiers</span>
            <span className="nv-tile__value nv-num">{figures.folders}</span>
          </div>
          <div className={`nv-tile${figures.unmarked > 0 ? ' nv-tone--warn' : ''}`}>
            <span className="nv-tile__label">
              {figures.unmarked > 0 ? <span className="nv-dot nv-tone--warn" aria-hidden="true" /> : null}À
              classer
            </span>
            <span className="nv-tile__value nv-num">{figures.unmarked}</span>
          </div>
        </div>
        {figures.unmarked > 0 ? (
          <p className="vx-note">
            Un dossier sans ☀️ ni 🌙 dans son nom ne dit pas s’il est de Jour ou de Nuit : renomme-le dans
            Reveal.
          </p>
        ) : null}
        <ul className="vx-folders">
          {shown.map((row) => (
            <li key={row.key} className="vx-folder">
              <span className="vx-folder__moment" aria-hidden="true">
                {row.emoji ?? '·'}
              </span>
              <span className="vx-folder__name">{row.name}</span>
              <span className="vx-folder__line nv-num">
                {row.line}
                {row.removed > 0 ? (
                  <span className="vx-folder__removed">
                    {row.removed === 1
                      ? ' · 1 retiré de Reveal'
                      : ` · ${String(row.removed)} retirés de Reveal`}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {rows.length > FOLDERS_SHOWN ? (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm ps-self-start"
            aria-expanded={open}
            onClick={() => {
              setOpen((was) => !was);
            }}
          >
            {open ? 'Voir moins' : `Voir les ${String(rows.length)} dossiers`}
          </button>
        ) : null}
      </>
    );
  };

  return (
    <section className="nv-plate vx-card" aria-label={`Coffre Reveal de ${creatorName}`}>
      <div className="vx-head">
        <div className="vx-head__who">
          <p className="ps-title">Son coffre Reveal</p>
          <p className="ps-muted vx-synced">
            {vault.data === undefined ? ' ' : syncedLine(vault.data.syncedAt, now)}
          </p>
        </div>
        {isOwner ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm vx-sync"
            disabled={running}
            aria-busy={running}
            onClick={sync}
          >
            {running ? <span className="nv-dot nv-dot--live" aria-hidden="true" /> : null}
            {running ? 'Synchro en cours' : 'Synchroniser le coffre'}
          </button>
        ) : null}
      </div>
      <p className={`vx-phase vx-phase--${said?.tone ?? 'muted'}`} role="status">
        {said?.text ?? ''}
      </p>
      {!isOwner ? <p className="ps-muted vx-note">Seul le propriétaire lance une synchro.</p> : null}
      {body()}
    </section>
  );
}
