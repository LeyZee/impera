import type { CreatorId, VaultFolderView, VaultMediaView } from '@impera/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { askVaultSync, useVault } from './api';
import {
  SYNC_POLL_MS,
  durationLine,
  findFolder,
  folderName,
  folderTiles,
  mediaKindLine,
  mediaLine,
  phaseAfterRead,
  phaseLine,
  polls,
  suggestedLine,
  syncedLine,
  uploadedLine,
  vaultFigures,
  type FolderTile,
  type SyncPhase,
} from './model';
import { previewOf } from './preview';
import './vault.css';

import { useNow } from '@/scheduling/useNow';

/**
 * « Son coffre Reveal » (ADR 0099 §§ 2-4): when her vault was last read, her folders as tiles, and a folder opened as the
 * grid of its media in Reveal's order, each with its sheet. For the owner alone « Synchroniser le coffre », the only
 * thing that reads it again (no cron); an active manager reads, never syncs: a sync reads the platform with her session.
 *
 * Each media shows the platform's blurred preview (ADR 0030 § 4), never the image: the sharp one waits for the files
 * to be read (vault-fetch-media). The folder opened lives in the address (`dossier`) when the page passes `folderId`
 * and `onFolder`; without them, in the card.
 */
export function VaultCard({
  creatorId,
  creatorName,
  isOwner,
  folderId,
  onFolder,
}: {
  creatorId: CreatorId;
  creatorName: string;
  isOwner: boolean;
  folderId?: string | null;
  onFolder?: (id: string | null) => void;
}): JSX.Element {
  const [phase, setPhase] = useState<SyncPhase>({ kind: 'idle' });
  const [ownFolder, setOwnFolder] = useState<string | null>(null);
  const vault = useVault(creatorId, polls(phase) ? SYNC_POLL_MS : false);
  const now = useNow();
  const opened = folderId === undefined ? ownFolder : folderId;
  const goTo = (id: string | null): void => {
    if (onFolder === undefined) setOwnFolder(id);
    else onFolder(id);
  };

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
  // A folder the address names but the last sync no longer lists: the folders, never an error.
  const folder = vault.data === undefined ? null : findFolder(vault.data, opened);

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
    if (folder !== null)
      return (
        <FolderView
          key={`${folder.platformAccountId}:${folder.folderRef ?? ''}`}
          folder={folder}
          onBack={() => {
            goTo(null);
          }}
        />
      );
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
        <ul className="vx-grid" aria-label="Ses dossiers">
          {folderTiles(vault.data).map((tile) => (
            <li key={tile.key} className="vx-grid__cell">
              <FolderButton
                tile={tile}
                onOpen={() => {
                  goTo(tile.id);
                }}
              />
            </li>
          ))}
        </ul>
      </>
    );
  };

  return (
    <section className="nv-plate vx-card" aria-label={`Coffre Reveal de ${creatorName}`}>
      <div className="vx-head">
        <div className="vx-head__who">
          <p className="ps-title">Son coffre Reveal</p>
          <p className="ps-muted vx-synced">
            {vault.data === undefined ? ' ' : syncedLine(vault.data.syncedAt, now)}
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
            {running ? <span className="nv-dot nv-dot--live" aria-hidden="true" /> : <SyncIcon />}
            {running ? 'Synchro en cours' : 'Synchroniser le coffre'}
          </button>
        ) : null}
      </div>
      {!isOwner ? <p className="ps-muted vx-note">Seul le propriétaire lance une synchro.</p> : null}
      {body()}
      {/* Under the figures, never above them: they do not move when a sync starts. */}
      <p className={`vx-phase vx-phase--${said?.tone ?? 'muted'}`} role="status">
        {said?.text ?? ''}
      </p>
    </section>
  );
}

/** A folder's tile: its cover of up to four blurred previews, its name as Reveal gives it, what it holds. */
function FolderButton({ tile, onOpen }: { tile: FolderTile; onOpen: () => void }): JSX.Element {
  return (
    <button type="button" className="vx-folder" onClick={onOpen} aria-label={`Ouvrir ${tile.name}`}>
      <span className={`vx-cover vx-cover--${String(Math.max(1, tile.cover.length))}`} aria-hidden="true">
        {tile.cover.length === 0 ? (
          <span className="vx-cover__empty">
            <FolderIcon />
          </span>
        ) : (
          tile.cover.map((hash, at) => <Preview key={at} hash={hash} />)
        )}
        <span className="vx-cover__open">
          <ChevronIcon />
        </span>
      </span>
      <span className="vx-folder__body">
        <span className="vx-folder__name">
          {tile.unmarked ? <span className="nv-dot nv-tone--warn" role="img" aria-label="À classer" /> : null}
          <span className="vx-folder__label">{tile.name}</span>
        </span>
        <span className="vx-folder__line nv-num">
          {tile.line}
          {tile.removed > 0 ? (
            <span className="vx-folder__removed">
              {tile.removed === 1 ? ' · 1 retiré de Reveal' : ` · ${String(tile.removed)} retirés de Reveal`}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/** A folder opened: « Coffre › son nom », then its media in Reveal's order, and the sheet of the one picked. */
function FolderView({ folder, onBack }: { folder: VaultFolderView; onBack: () => void }): JSX.Element {
  const [picked, setPicked] = useState<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const name = folderName(folder);
  const media = picked === null ? undefined : folder.media.find((each) => each.platformMediaId === picked);

  // Opened from a tile: the reader lands on the folder's name, not back at the page's top.
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (picked === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPicked(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [picked]);

  return (
    <div className="vx-open">
      <nav className="vx-crumbs" aria-label="Chemin dans le coffre">
        <button type="button" className="vx-crumbs__back nv-tap" onClick={onBack}>
          <span className="vx-crumbs__chev" aria-hidden="true">
            <ChevronIcon />
          </span>
          Coffre
        </button>
        <span className="vx-crumbs__sep" aria-hidden="true">
          /
        </span>
        <span className="vx-crumbs__here" aria-current="page">
          {name}
        </span>
      </nav>
      <div className="vx-open__head">
        <h3 className="vx-open__title" ref={title} tabIndex={-1}>
          {folder.folderRef !== null && folder.moment === null ? (
            <span className="nv-dot nv-tone--warn" role="img" aria-label="À classer" />
          ) : null}
          {name}
        </h3>
        <p className="ps-muted vx-open__line nv-num">{mediaLine(folder.media)}</p>
      </div>
      {folder.media.length === 0 ? (
        <div className="vx-empty">
          <p className="vx-empty__title">Dossier vide</p>
          <p className="ps-muted">Reveal n’a listé aucun média dans ce dossier à la dernière synchro.</p>
        </div>
      ) : (
        <div className={`vx-browse${media === undefined ? '' : ' vx-browse--sheet'}`}>
          <ul className="vx-media" aria-label={`Médias de ${name}`}>
            {folder.media.map((each, at) => (
              <li key={each.platformMediaId} className="vx-media__cell">
                <MediaButton
                  media={each}
                  rank={at + 1}
                  picked={each.platformMediaId === picked}
                  onPick={() => {
                    setPicked((was) => (was === each.platformMediaId ? null : each.platformMediaId));
                  }}
                />
              </li>
            ))}
          </ul>
          {media === undefined ? null : (
            <MediaSheet
              key={media.platformMediaId}
              media={media}
              onClose={() => {
                setPicked(null);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MediaButton({
  media,
  rank,
  picked,
  onPick,
}: {
  media: VaultMediaView;
  rank: number;
  picked: boolean;
  onPick: () => void;
}): JSX.Element {
  const what = mediaKindLine(media);
  return (
    <button
      type="button"
      className={`vx-tile vx-tile--${media.kind}${media.removed ? ' vx-tile--removed' : ''}`}
      aria-pressed={picked}
      aria-label={`${String(rank)}. ${what}${media.removed ? ', retiré de Reveal' : ''}`}
      onClick={onPick}
    >
      <Preview hash={media.blurhash} />
      <span className="vx-tile__kind" aria-hidden="true">
        <KindIcon kind={media.kind} />
      </span>
      {media.kind !== 'image' && media.durationSeconds !== null ? (
        <span className="vx-tile__time nv-num" aria-hidden="true">
          {durationLine(media.durationSeconds)}
        </span>
      ) : null}
      {media.removed ? (
        <span className="vx-tile__gone" aria-hidden="true">
          Retiré
        </span>
      ) : null}
    </button>
  );
}

/** What the CRM knows of one media: what it is, when it came, Reveal's own text and range. Never the image. */
function MediaSheet({ media, onClose }: { media: VaultMediaView; onClose: () => void }): JSX.Element {
  return (
    <aside className="vx-sheet" aria-label="Fiche du média">
      <div className="vx-sheet__top">
        <div className={`vx-sheet__preview vx-tile--${media.kind}`}>
          <Preview hash={media.blurhash} />
          <span className="vx-tile__kind" aria-hidden="true">
            <KindIcon kind={media.kind} />
          </span>
        </div>
        <button
          type="button"
          className="nv-close vx-sheet__close"
          aria-label="Fermer la fiche"
          onClick={onClose}
        >
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>
      <p className="vx-sheet__what">{mediaKindLine(media)}</p>
      <p className="ps-muted vx-sheet__when">{uploadedLine(media.uploadedAt)}</p>
      {media.removed ? (
        <p className="vx-sheet__gone">Retiré de Reveal : gardé ici avec ses descriptions.</p>
      ) : null}
      <dl className="vx-sheet__facts">
        <div className="vx-sheet__fact">
          <dt>Texte de Reveal</dt>
          <dd>{media.platformDescription ?? <span className="ps-muted">Aucun texte dans Reveal.</span>}</dd>
        </div>
        {media.suggestedPriceMinor === null ? null : (
          <div className="vx-sheet__fact">
            <dt>Prix suggéré par Reveal</dt>
            <dd className="nv-num">{suggestedLine(media.suggestedPriceMinor)}</dd>
          </div>
        )}
      </dl>
      <p className="vx-note">Aperçu flouté : l’image nette viendra avec la lecture des fichiers.</p>
    </aside>
  );
}

/** The platform's blurred preview, or the kind's own colour when it gave none. */
function Preview({ hash }: { hash: string | null }): JSX.Element {
  const src = hash === null ? null : previewOf(hash);
  return src === null ? (
    <span className="vx-preview vx-preview--none" aria-hidden="true" />
  ) : (
    <img className="vx-preview" src={src} alt="" aria-hidden="true" draggable={false} />
  );
}

function KindIcon({ kind }: { kind: VaultMediaView['kind'] }): JSX.Element {
  if (kind === 'video')
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5.5 3.8v8.4a.6.6 0 0 0 .9.5l6.6-4.2a.6.6 0 0 0 0-1L6.4 3.3a.6.6 0 0 0-.9.5Z" />
      </svg>
    );
  if (kind === 'audio')
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 6.5v3M5.5 4v8M8 2.5v11M10.5 5v6M13 7v2" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <path d="m3.5 11.5 3-3.2 2.2 2.2 1.6-1.5 2.2 2.5" />
      <circle cx="10.5" cy="6" r="1.1" />
    </svg>
  );
}

function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  );
}

function SyncIcon(): JSX.Element {
  return (
    <svg className="vx-sync__icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 6.5A5.2 5.2 0 0 0 3.6 5M3 9.5a5.2 5.2 0 0 0 9.4 1.5" />
      <path d="M3.3 2.6 3.6 5l2.4-.3M12.7 13.4l-.3-2.4-2.4.3" />
    </svg>
  );
}
