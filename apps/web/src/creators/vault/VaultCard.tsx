import type { CreatorId, VaultFolderView, VaultMediaView } from '@impera/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { askVaultSync, useVault, vaultPreviewUrl } from './api';
import {
  SYNC_POLL_MS,
  durationLine,
  findFolder,
  folderLine,
  folderName,
  folderTiles,
  mediaKindLine,
  phaseAfterRead,
  phaseLine,
  polls,
  removedLine,
  suggestedLine,
  syncedLine,
  uploadedLine,
  vaultFigures,
  waveOf,
  type FolderTile,
  type SyncPhase,
} from './model';
import { previewOf } from './preview';
import './vault.css';

import { useNow } from '@/scheduling/useNow';
import { Dialog } from '@/shell/Dialog';
import { setMediaBlur, useMediaBlur } from '@/shell/media-blur';

/**
 * « Son coffre Reveal » (ADR 0099 §§ 2-4): when her vault was last read, her folders as tiles, and a folder opened as the
 * grid of its media in Reveal's order, each with its sheet. For the owner alone « Synchroniser le coffre », the only
 * thing that reads it again (no cron); an active manager reads, never syncs: a sync reads the platform with her session.
 *
 * Each media shows the platform's blurred preview first (ADR 0030 § 4); its sharp small picture comes on a gesture
 * (ADR 0138): « Voir net » for the whole folder, the pointer on one media, its sheet. Read at Reveal by the server,
 * never kept. The folder opened lives in the address (`dossier`) when the page passes `folderId` and `onFolder`;
 * without them, in the card.
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
          creatorId={creatorId}
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
  const gone = removedLine(tile.removed);
  return (
    <button type="button" className="vx-folder" onClick={onOpen} aria-label={`Ouvrir ${tile.name}`}>
      <span className={`vx-cover vx-cover--${String(Math.max(1, tile.cover.length))}`} aria-hidden="true">
        {tile.cover.length === 0 ? (
          <span className="vx-cover__empty">
            <FolderIcon />
          </span>
        ) : (
          tile.cover.map((item) =>
            item.kind === 'audio' ? (
              <VoiceFace key={item.seed} seed={item.seed} bars={9} />
            ) : (
              <Preview key={item.seed} hash={item.hash} />
            ),
          )
        )}
        {gone === null ? null : (
          <span className="vx-cover__gone nv-num">
            <GoneIcon />
            {tile.removed === 1 ? '1 retiré' : `${String(tile.removed)} retirés`}
          </span>
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
        <span className="vx-folder__line nv-num">{tile.line}</span>
      </span>
    </button>
  );
}

/**
 * A folder opened: « Coffre / son nom » as its title, « Voir net » on the same line, then its media in Reveal's order.
 * « Voir net » is the rail's « Flou des médias » itself (ADR 0030 § 4): one choice of this browser, so the rail never says
 * « Floutés » over a sharp grid. A media picked opens its sheet over the page, the grid never moving under it.
 */
function FolderView({
  creatorId,
  folder,
  onBack,
}: {
  creatorId: CreatorId;
  folder: VaultFolderView;
  onBack: () => void;
}): JSX.Element {
  const [picked, setPicked] = useState<string | null>(null);
  const blurred = useMediaBlur();
  const pictured = folder.media.some((each) => each.kind !== 'audio' && !each.removed);
  const title = useRef<HTMLHeadingElement>(null);
  const name = folderName(folder);
  const at = picked === null ? -1 : folder.media.findIndex((each) => each.platformMediaId === picked);
  const media = at < 0 ? undefined : folder.media[at];

  // Opened from a tile: the reader lands on the folder's name, not back at the page's top.
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);

  const step = (by: -1 | 1): void => {
    const next = folder.media[at + by];
    if (next !== undefined) setPicked(next.platformMediaId);
  };

  return (
    <div className="vx-open">
      <div className="vx-open__head">
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
          <h3 className="vx-crumbs__here" ref={title} tabIndex={-1} aria-current="page">
            {folder.folderRef !== null && folder.moment === null ? (
              <span className="nv-dot nv-tone--warn" role="img" aria-label="À classer" />
            ) : null}
            <span className="vx-crumbs__name">{name}</span>
          </h3>
        </nav>
        {pictured ? (
          <button
            type="button"
            className={`nv-btn nv-btn--soft nv-btn--sm vx-open__sharp${blurred ? '' : ' vx-open__sharp--on'}`}
            aria-pressed={!blurred}
            onClick={() => {
              setMediaBlur(!blurred);
            }}
          >
            <EyeIcon open={!blurred} />
            {blurred ? 'Voir net' : 'Flouter'}
          </button>
        ) : null}
      </div>
      <p className="ps-muted vx-open__line nv-num">{folderLine(folder.media)}</p>
      {folder.media.length === 0 ? (
        <div className="vx-empty">
          <p className="vx-empty__title">Dossier vide</p>
          <p className="ps-muted">Reveal n’a listé aucun média dans ce dossier à la dernière synchro.</p>
        </div>
      ) : (
        <ul className="vx-media" aria-label={`Médias de ${name}`}>
          {folder.media.map((each, rank) => (
            <li key={each.platformMediaId} className="vx-media__cell">
              <MediaButton
                creatorId={creatorId}
                sharp={!blurred}
                media={each}
                rank={rank + 1}
                picked={each.platformMediaId === picked}
                onPick={() => {
                  setPicked(each.platformMediaId);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {media === undefined ? null : (
        <MediaSheet
          creatorId={creatorId}
          media={media}
          rank={at + 1}
          count={folder.media.length}
          onStep={step}
          onClose={() => {
            setPicked(null);
          }}
        />
      )}
    </div>
  );
}

function MediaButton({
  creatorId,
  sharp,
  media,
  rank,
  picked,
  onPick,
}: {
  creatorId: CreatorId;
  sharp: boolean;
  media: VaultMediaView;
  rank: number;
  picked: boolean;
  onPick: () => void;
}): JSX.Element {
  const [pointed, setPointed] = useState(false);
  const what = mediaKindLine(media);
  return (
    <button
      type="button"
      className={`vx-tile vx-tile--${media.kind}${media.removed ? ' vx-tile--removed' : ''}`}
      aria-pressed={picked}
      aria-label={`${String(rank)}. ${what}${media.removed ? ', retiré de Reveal' : ''}`}
      onClick={onPick}
      onPointerEnter={() => {
        setPointed(true);
      }}
      onPointerLeave={() => {
        setPointed(false);
      }}
    >
      {media.kind === 'audio' ? (
        <VoiceFace seed={media.platformMediaId} bars={14} />
      ) : (
        <>
          <Preview hash={media.blurhash} />
          {sharp || pointed ? <Sharp creatorId={creatorId} media={media} /> : null}
        </>
      )}
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
          <GoneIcon />
          Retiré
        </span>
      ) : null}
    </button>
  );
}

/**
 * One media's sheet, over the page (the app's own `Dialog`: a sheet from the bottom on a phone, a panel on a computer):
 * its sharp small picture, what it is, when it came, Reveal's own text and range, and the way to the one before or after
 * (the arrows of the keyboard too).
 */
function MediaSheet({
  creatorId,
  media,
  rank,
  count,
  onStep,
  onClose,
}: {
  creatorId: CreatorId;
  media: VaultMediaView;
  rank: number;
  count: number;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft') onStep(-1);
      if (event.key === 'ArrowRight') onStep(1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onStep]);

  return (
    <Dialog
      title={mediaKindLine(media)}
      lead={uploadedLine(media.uploadedAt)}
      className="vx-dialog"
      onClose={onClose}
    >
      <div className="vx-sheet">
        <div
          key={media.platformMediaId}
          className={`vx-sheet__preview vx-tile--${media.kind}${media.removed ? ' vx-tile--removed' : ''}`}
        >
          {media.kind === 'audio' ? (
            <VoiceFace seed={media.platformMediaId} bars={28} />
          ) : (
            <>
              <Preview hash={media.blurhash} />
              <Sharp creatorId={creatorId} media={media} />
            </>
          )}
          {media.kind !== 'image' && media.durationSeconds !== null ? (
            <span className="vx-tile__time nv-num" aria-hidden="true">
              {durationLine(media.durationSeconds)}
            </span>
          ) : null}
          {media.removed ? (
            <span className="vx-tile__gone" aria-hidden="true">
              <GoneIcon />
              Retiré
            </span>
          ) : null}
        </div>
        <div className="vx-sheet__steps">
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm vx-sheet__step"
            aria-label="Média précédent"
            disabled={rank <= 1}
            onClick={() => {
              onStep(-1);
            }}
          >
            <span className="vx-sheet__back" aria-hidden="true">
              <ChevronIcon />
            </span>
          </button>
          <span className="ps-muted nv-num">
            {rank} sur {count}
          </span>
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm vx-sheet__step"
            aria-label="Média suivant"
            disabled={rank >= count}
            onClick={() => {
              onStep(1);
            }}
          >
            <span aria-hidden="true">
              <ChevronIcon />
            </span>
          </button>
        </div>
        {media.removed ? (
          <p className="vx-sheet__gone">Retiré de Reveal : gardé ici avec ses descriptions.</p>
        ) : null}
        <dl className="vx-sheet__facts">
          <div className="vx-sheet__fact">
            <dt className="nv-eyebrow">Texte de Reveal</dt>
            <dd>{media.platformDescription ?? <span className="ps-muted">Aucun texte dans Reveal.</span>}</dd>
          </div>
          {media.suggestedPriceMinor === null ? null : (
            <div className="vx-sheet__fact">
              <dt className="nv-eyebrow">Prix suggéré par Reveal</dt>
              <dd className="nv-num">{suggestedLine(media.suggestedPriceMinor)}</dd>
            </div>
          )}
        </dl>
        {media.kind === 'audio' || media.removed ? null : (
          <p className="vx-note">Image lue dans Reveal à l’instant, jamais gardée par Impera.</p>
        )}
      </div>
    </Dialog>
  );
}

/** A voice note's face: the theme's surface and a drawn wave (`waveOf`), never a grey blur that reads as disabled. */
function VoiceFace({ seed, bars }: { seed: string; bars: number }): JSX.Element {
  const wave = waveOf(seed, bars);
  return (
    <span className="vx-voice" aria-hidden="true">
      <svg className="vx-voice__wave" viewBox={`0 0 ${String(bars * 4)} 20`} preserveAspectRatio="none">
        {wave.map((height, at) => (
          <rect
            key={at}
            x={at * 4 + 1}
            y={10 - height * 9}
            width="2"
            height={height * 18}
            rx="1"
            style={{ animationDelay: `${String(at * 40)}ms` }}
          />
        ))}
      </svg>
    </span>
  );
}

/**
 * The sharp small picture over the blurred one (ADR 0138), faded in once loaded; on any failure it stays hidden and
 * the blur shows. Never for a voice note nor a media Reveal removed: there is no picture to read.
 */
function Sharp({ creatorId, media }: { creatorId: CreatorId; media: VaultMediaView }): JSX.Element | null {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  if (media.kind === 'audio' || media.removed || state === 'failed') return null;
  return (
    <img
      className="vx-sharp"
      data-state={state}
      src={vaultPreviewUrl(creatorId, media.platformMediaId)}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      onLoad={() => {
        setState('shown');
      }}
      onError={() => {
        setState('failed');
      }}
    />
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

function EyeIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg className="vx-eye" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8Z" />
      {open ? <path d="m2.5 13.5 11-11" /> : <circle cx="8" cy="8" r="1.9" />}
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

/** No longer in Reveal: a cloud struck through. */
function GoneIcon(): JSX.Element {
  return (
    <svg className="vx-gone" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.6 12.2h6.6a2.8 2.8 0 0 0 .5-5.6 4 4 0 0 0-7.6-.9A3.3 3.3 0 0 0 4.6 12.2Z" />
      <path d="m2.5 2.5 11 11" />
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
