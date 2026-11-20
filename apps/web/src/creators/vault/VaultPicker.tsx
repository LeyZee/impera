import type { CreatorId, VaultFolderView, VaultMediaView } from '@impera/contracts';
import { useState, type CSSProperties, type JSX } from 'react';

import type { ChoiceIndex } from './choice';
import { durationLine, mediaKindLine, mediaLine, syncedLine } from './model';
import { ChevronIcon, FolderIcon, Preview, Sharp, SyncIcon, VoiceFace } from './parts';
import {
  PICKER_PAGE,
  applyLabel,
  draftSummary,
  folderFilled,
  folderToggled,
  inImperaLine,
  mediaToggled,
  pickKey,
  pickOf,
  pickedIds,
  pickerFolderName,
  pickerMedia,
  draftLine,
  type PickDraft,
} from './picker';
import './vault-picker.css';

import { SaveBar } from '@/creators/SaveBar';
import { Dialog } from '@/shell/Dialog';
import { useMediaBlur } from '@/shell/media-blur';

/** How many cards enter one after the other; the others are there at once. */
const STAGGERED = 12;
/** How many previews make a card's mosaic. */
const MOSAIC = 4;

/**
 * « Choisir dans Reveal » (ADR 0145 § 5, avenant du 20/11): what the last sync read of her vault, her folders as cards,
 * and the owner's ticks. A card ticks its folder whole; « Voir les médias » opens it to tick its media one by one. Nothing
 * is written before « Importer », at the foot, which says what enters Impera and what leaves it. The pictures follow the
 * menu's « Flou des médias », here as everywhere.
 */
export function VaultPicker({
  creatorId,
  folders,
  index,
  syncedAt,
  reading,
  readLine,
  startFolder,
  now,
  saving,
  failed,
  onApply,
  onClose,
}: {
  creatorId: CreatorId;
  /** Her folders in the rail's order, the media outside any folder last; `null` before a first read. */
  folders: readonly VaultFolderView[] | null;
  index: ChoiceIndex;
  syncedAt: string | null;
  /** A sync asked from the window runs: the cards may still change. */
  reading: boolean;
  /** What the sync says, under the title; `null` when nothing. */
  readLine: string | null;
  /** A folder to open at once (« Choisir les autres » from a folder in part), by its key. */
  startFolder: string | null;
  now: Date;
  saving: boolean;
  failed: boolean;
  onApply: (draft: PickDraft) => void;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<PickDraft>(new Map());
  const [open, setOpen] = useState<string | null>(startFolder);
  const blurred = useMediaBlur();
  const listed = folders ?? [];
  const opened = open === null ? undefined : listed.find((each) => pickKey(each) === open);
  const summary = draftSummary(draft, index, listed);
  const said = draftLine(draft);
  const total = listed.reduce((sum, folder) => sum + pickerMedia(folder).length, 0);

  return (
    <Dialog
      title="Choisir dans Reveal"
      lead="Coche ce qui entre dans Impera : seuls ces médias servent à construire ses scripts et à l’IA. Rien ne change dans Reveal."
      busy={saving}
      className="vk"
      onClose={onClose}
    >
      <div className="vk-status">
        <span className="vk-status__when nv-num">
          {reading ? <span className="nv-dot nv-dot--live" aria-hidden="true" /> : <SyncIcon />}
          {reading ? 'Lecture de son coffre Reveal…' : syncedLine(syncedAt, now)}
        </span>
        {folders === null || listed.length === 0 ? null : (
          <span className="vk-status__count nv-num">
            {listed.length.toLocaleString('fr-FR')} {listed.length === 1 ? 'dossier' : 'dossiers'} ·{' '}
            {total.toLocaleString('fr-FR')} {total === 1 ? 'média' : 'médias'}
          </span>
        )}
      </div>
      {readLine === null ? null : (
        <p className="vk-read" role="status">
          {readLine}
        </p>
      )}
      {folders === null ? (
        <ul className="vk-cards" aria-busy="true" aria-label="Lecture de ses dossiers">
          {Array.from({ length: 6 }, (_, at) => (
            <li key={at} className="vk-card vk-card--ghost">
              <span className="ps-skeleton vk-card__mosaic" />
              <span className="ps-skeleton vk-card__ghost-line" />
            </li>
          ))}
        </ul>
      ) : listed.length === 0 ? (
        <div className="vx-empty vk-empty">
          <p className="vx-empty__title">{reading ? 'Lecture en cours' : 'Coffre vide'}</p>
          <p className="ps-muted">
            {reading
              ? 'Ses dossiers apparaissent ici dès que Reveal les a donnés.'
              : 'Reveal n’a listé aucun média à la dernière synchro.'}
          </p>
        </div>
      ) : opened === undefined ? (
        <ul className="vk-cards" aria-label="Ses dossiers dans Reveal">
          {listed.map((folder, at) => (
            <FolderCard
              key={pickKey(folder)}
              creatorId={creatorId}
              folder={folder}
              draft={draft}
              index={index}
              sharp={!blurred}
              order={at}
              onTick={() => {
                setDraft((current) => folderToggled(current, index, folder));
              }}
              onOpen={() => {
                setOpen(pickKey(folder));
              }}
            />
          ))}
        </ul>
      ) : (
        <FolderMedia
          key={pickKey(opened)}
          creatorId={creatorId}
          folder={opened}
          draft={draft}
          index={index}
          sharp={!blurred}
          onBack={() => {
            setOpen(null);
          }}
          onTickAll={() => {
            setDraft((current) => folderFilled(current, index, opened));
          }}
          onTick={(id) => {
            setDraft((current) => mediaToggled(current, index, opened, id));
          }}
        />
      )}
      {failed ? (
        <p className="tm-warn vk-failed" role="alert">
          Le choix n’a pas été enregistré : le serveur ne répond pas. Réessaie dans un instant.
        </p>
      ) : null}
      <SaveBar
        show={said !== null}
        warn={false}
        text={said ?? ''}
        saveLabel={applyLabel(summary)}
        saving={saving}
        blocked={null}
        onReset={() => {
          setDraft(new Map());
        }}
        onSave={() => {
          onApply(draft);
        }}
      />
    </Dialog>
  );
}

/**
 * One folder of hers as a card: its mosaic, its name as Reveal gives it, what it holds, where it stands in Impera. The
 * whole card ticks it; « Voir les médias » opens it.
 */
function FolderCard({
  creatorId,
  folder,
  draft,
  index,
  sharp,
  order,
  onTick,
  onOpen,
}: {
  creatorId: CreatorId;
  folder: VaultFolderView;
  draft: PickDraft;
  index: ChoiceIndex;
  sharp: boolean;
  order: number;
  onTick: () => void;
  onOpen: () => void;
}): JSX.Element {
  const pick = pickOf(draft, index, folder);
  const changed = draft.has(pickKey(folder));
  const media = pickerMedia(folder);
  const name = pickerFolderName(folder);
  // A tick not yet sent says what it will do; otherwise, where the folder stands in Impera today.
  const where = changed ? (pick.kind === 'none' ? 'À retirer' : 'À importer') : inImperaLine(pick, folder);
  const style: CSSProperties = { '--vk-order': Math.min(order, STAGGERED) };
  return (
    <li className="vk-card" data-pick={pick.kind} data-changed={changed ? '' : undefined} style={style}>
      <button
        type="button"
        className="vk-card__tick-area"
        role="checkbox"
        aria-checked={pick.kind === 'all' ? true : pick.kind === 'some' ? 'mixed' : false}
        aria-label={`${name} : ${mediaLine(folder.media)}`}
        onClick={onTick}
      >
        <span className="vk-card__mosaic" data-count={Math.min(media.length, MOSAIC)}>
          {media.length === 0 ? (
            <span className="vk-card__empty">
              <FolderIcon />
            </span>
          ) : (
            media.slice(0, MOSAIC).map((each) => (
              <span key={each.platformMediaId} className="vk-card__cell">
                <Face creatorId={creatorId} media={each} sharp={sharp} bars={8} />
              </span>
            ))
          )}
          <span className="vk-tick" data-state={pick.kind} aria-hidden="true" />
        </span>
        <span className="vk-card__text">
          <span className="vk-card__name">{name}</span>
          <span className="vk-card__line nv-num">{mediaLine(folder.media)}</span>
        </span>
      </button>
      <span className="vk-card__foot">
        <span className="vk-card__where nv-num" data-where={where === null ? undefined : pick.kind}>
          {where ?? 'Pas dans Impera'}
        </span>
        {media.length === 0 ? null : (
          <button type="button" className="vk-card__open nv-tap" onClick={onOpen}>
            Voir les médias
            <ChevronIcon />
          </button>
        )}
      </span>
    </li>
  );
}

/** A folder open in the window: its media ticked one by one, by pages of `PICKER_PAGE`. */
function FolderMedia({
  creatorId,
  folder,
  draft,
  index,
  sharp,
  onBack,
  onTickAll,
  onTick,
}: {
  creatorId: CreatorId;
  folder: VaultFolderView;
  draft: PickDraft;
  index: ChoiceIndex;
  sharp: boolean;
  onBack: () => void;
  onTickAll: () => void;
  onTick: (id: string) => void;
}): JSX.Element {
  const [shown, setShown] = useState(PICKER_PAGE);
  const pick = pickOf(draft, index, folder);
  const ids = pickedIds(pick, folder);
  const media = pickerMedia(folder);
  const name = pickerFolderName(folder);
  const left = media.length - shown;
  return (
    <div className="vk-folder">
      <div className="vk-folder__head">
        <button type="button" className="vk-back nv-tap" onClick={onBack}>
          <span className="vk-back__chev" aria-hidden="true">
            <ChevronIcon />
          </span>
          Tous les dossiers
        </button>
        <div className="vk-folder__title">
          <h3 className="nv-h3 vk-folder__name">{name}</h3>
          <p className="ps-muted nv-num vk-folder__line">
            {ids.size.toLocaleString('fr-FR')} sur {media.length.toLocaleString('fr-FR')} cochés
          </p>
        </div>
        <button type="button" className="nv-btn nv-btn--soft nv-btn--sm vk-folder__all" onClick={onTickAll}>
          {pick.kind === 'all' ? 'Tout décocher' : 'Tout cocher'}
        </button>
      </div>
      <ul className="vk-grid" aria-label={`Médias de ${name}`}>
        {media.slice(0, shown).map((each, at) => {
          const on = ids.has(each.platformMediaId);
          return (
            <li key={each.platformMediaId} className="vk-media" data-on={on ? '' : undefined}>
              <button
                type="button"
                className="vk-media__tile"
                role="checkbox"
                aria-checked={on}
                aria-label={`${String(at + 1)}. ${mediaKindLine(each)}`}
                onClick={() => {
                  onTick(each.platformMediaId);
                }}
              >
                <Face creatorId={creatorId} media={each} sharp={sharp} bars={14} />
                <span className="vk-tick" data-state={on ? 'all' : 'none'} aria-hidden="true" />
                {each.kind !== 'image' && each.durationSeconds !== null ? (
                  <span className="vx-tile__time nv-num" aria-hidden="true">
                    {durationLine(each.durationSeconds)}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {left > 0 ? (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm vk-more"
          onClick={() => {
            setShown((current) => current + PICKER_PAGE);
          }}
        >
          Afficher {Math.min(left, PICKER_PAGE).toLocaleString('fr-FR')} de plus ·{' '}
          {left.toLocaleString('fr-FR')} restants
        </button>
      ) : null}
    </div>
  );
}

/** A media's face: a voice note's wave, else the platform's blur, sharp when the menu says « Nets ». */
function Face({
  creatorId,
  media,
  sharp,
  bars,
}: {
  creatorId: CreatorId;
  media: VaultMediaView;
  sharp: boolean;
  bars: number;
}): JSX.Element {
  if (media.kind === 'audio') return <VoiceFace seed={media.platformMediaId} bars={bars} />;
  return (
    <>
      <Preview hash={media.blurhash} />
      {sharp ? <Sharp creatorId={creatorId} media={media} /> : null}
    </>
  );
}
