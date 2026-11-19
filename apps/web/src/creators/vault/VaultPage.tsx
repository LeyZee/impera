import type {
  CreatorId,
  VaultChoicesChange,
  VaultDescribeAnswer,
  VaultFolderView,
  VaultMediaView,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react';

import {
  askVaultDescribe,
  askVaultSync,
  putVaultChoices,
  useVault,
  useVaultChoices,
  vaultChoicesKey,
} from './api';
import {
  DESCRIBE_AT_ONCE,
  FILTER_NAMES,
  GROUP_NAMES,
  VAULT_FILTERS,
  allToggled,
  centsLine,
  choiceFigures,
  choiceIndex,
  choiceOf,
  describable,
  describeEstimate,
  describeProgress,
  descriptionLine,
  filteredMedia,
  folderCount,
  importLine,
  mediaGroups,
  progressLine,
  railFolders,
  rangeSelected,
  selectable,
  selectedLine,
  summaryLine,
  toggled,
  type ChoiceIndex,
  type FolderCount,
  type VaultFilter,
} from './choice';
import {
  SYNC_POLL_MS,
  durationLine,
  findFolder,
  folderIdOf,
  folderLine,
  folderName,
  mediaKindLine,
  phaseAfterRead,
  phaseLine,
  polls,
  syncedLine,
  vaultFigures,
  type SyncPhase,
} from './model';
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  EyeIcon,
  FolderIcon,
  GoneIcon,
  MediaSheet,
  Preview,
  SelectIcon,
  Sharp,
  SparkIcon,
  SyncIcon,
  VoiceFace,
} from './parts';
import './vault.css';
import './vault-page.css';

import { useNow } from '@/scheduling/useNow';
import { Dialog } from '@/shell/Dialog';
import { useMediaBlur } from '@/shell/media-blur';
import { Failure } from '@/shell/states';

/** How often the choices are read again while descriptions asked from this page run; never past `PROGRESS_PATIENCE_MS`. */
const PROGRESS_POLL_MS = 4_000;
const PROGRESS_PATIENCE_MS = 10 * 60_000;

/** A run of descriptions asked from this page: its folder, its media, when. */
interface Batch {
  readonly folder: string;
  readonly ids: readonly string[];
  readonly askedAt: number;
}

const keyOf = (folder: Pick<VaultFolderView, 'platformAccountId' | 'folderRef'>): string =>
  `${folder.platformAccountId}:${folder.folderRef ?? ''}`;

/**
 * « Son coffre Reveal », by choice (ADR 0099 §§ 2-4, ADR 0145 § 5): her folders on the left, each with its import tick
 * (all, some, none: nothing at first, the root an ordinary folder at the bottom), the folder open on the right as a grid.
 * The owner picks media (« Sélectionner », Shift for a run, « Tout sélectionner dans ce dossier ») and, from the bar that
 * floats under the grid, imports them, has them described with the cost said on the button and again before anything
 * starts, or takes them out. An active manager reads, never picks nor syncs.
 *
 * The tiles are the platform's blur (ADR 0030 § 4), sharp on a gesture (ADR 0138): the pointer on one outside a
 * selection, « Voir net » for the folder, the eye in a tile's corner while selecting, its sheet. On a phone the folders
 * are a list, and a folder opened takes the screen with its way back.
 */
export function VaultPage({
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
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<SyncPhase>({ kind: 'idle' });
  const [ownFolder, setOwnFolder] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const vault = useVault(creatorId, polls(phase) ? SYNC_POLL_MS : false);
  const now = useNow();

  const folders = useMemo(() => (vault.data === undefined ? [] : railFolders(vault.data)), [vault.data]);
  const batchFolder = batch === null ? undefined : folders.find((each) => keyOf(each) === batch.folder);
  const [index, setIndex] = useState<ChoiceIndex>(() => choiceIndex(undefined));
  const progress = batch === null ? null : describeProgress(batch.ids, batchFolder, index);
  const describing =
    batch !== null &&
    progress !== null &&
    progress.done < progress.total &&
    now.getTime() - batch.askedAt < PROGRESS_PATIENCE_MS;
  const choices = useVaultChoices(creatorId, describing || polls(phase) ? PROGRESS_POLL_MS : false);
  useEffect(() => {
    setIndex(choiceIndex(choices.data));
  }, [choices.data]);

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

  /** A change of ticks, in turns of the most one request takes: the choices as they now stand, or `false`. */
  const change = async (body: VaultChoicesChange): Promise<boolean> => {
    setPending(true);
    setFailed(false);
    let last = null;
    for (let at = 0; at === 0 || at < body.media.length; at += DESCRIBE_AT_ONCE) {
      last = await putVaultChoices(creatorId, {
        ...body,
        folders: at === 0 ? body.folders : [],
        media: body.media.slice(at, at + DESCRIBE_AT_ONCE),
      });
      if (last === null) break;
    }
    setPending(false);
    if (last === null) {
      setFailed(true);
      return false;
    }
    queryClient.setQueryData(vaultChoicesKey(creatorId), last);
    return true;
  };

  const running = phase.kind === 'asking' || phase.kind === 'waiting' || phase.kind === 'slow';
  const said = phaseLine(phase);
  const chosen = vault.data === undefined ? null : findFolder(vault.data, opened);
  // On a computer a folder is always open, the first one when none is named; on a phone, the list until one is.
  const shown = chosen ?? folders[0] ?? null;

  const body = (): JSX.Element => {
    if (vault.data === undefined) {
      if (vault.isError)
        return <Failure inline title="Son coffre ne se charge pas" onRetry={() => void vault.refetch()} />;
      return <div className="ps-skeleton vx-skeleton vp-skeleton" aria-busy="true" />;
    }
    if (vault.data.syncedAt === null && vault.data.folders.length === 0)
      return (
        <div className="vx-empty">
          <p className="vx-empty__title">
            {isOwner ? 'Première synchro à lancer' : 'En attente de la première synchro'}
          </p>
          <p className="ps-muted">
            {isOwner
              ? `Lance une première synchro : Impera lit le coffre Reveal de ${creatorName}, dossier par dossier, sans rien y changer. Rien n’entre dans Impera avant que tu le coches.`
              : `Le propriétaire lance la première synchro : le coffre Reveal de ${creatorName} apparaîtra ici.`}
          </p>
        </div>
      );
    if (vault.data.folders.length === 0 || shown === null)
      return (
        <div className="vx-empty">
          <p className="vx-empty__title">Coffre vide</p>
          <p className="ps-muted">Reveal n’a listé aucun média à la dernière synchro.</p>
        </div>
      );
    const figures = vaultFigures(vault.data);
    const chosenFigures = choiceFigures(vault.data, index);
    const share = (value: number): number => (chosenFigures.listed === 0 ? 0 : value / chosenFigures.listed);
    return (
      <>
        {/* Nothing imported yet: one sentence says it, no figures and no empty gauge. Then one line of figures, and a
            gauge of what is imported across the card's width; described is said by the line alone. */}
        {chosenFigures.imported === 0 && isOwner && choices.data !== undefined ? (
          <p className="vx-note vp-first">
            Rien n’est encore importé : coche un dossier entier, ou ouvre-le et sélectionne ses médias. Seuls
            les médias importés servent aux scripts et à l’IA.
          </p>
        ) : (
          <div className="vp-sum" data-chosen={chosen === null ? undefined : ''}>
            <p className="vp-sum__line nv-num">{summaryLine(chosenFigures)}</p>
            {chosenFigures.imported === 0 ? null : (
              <span className="vp-sum__meter" aria-hidden="true">
                <span className="vp-sum__in" style={{ '--vp-share': share(chosenFigures.imported) }} />
              </span>
            )}
          </div>
        )}
        <div className="vp-body" data-chosen={chosen === null ? undefined : ''}>
          <nav className="vp-rail" aria-label="Ses dossiers">
            <p className="nv-eyebrow vp-rail__head">
              <span>Dossiers</span>
              <span className="nv-num">{figures.folders}</span>
            </p>
            <ul className="vp-rail__list">
              {folders.map((folder) => (
                <FolderRow
                  key={keyOf(folder)}
                  folder={folder}
                  count={folderCount(index, folder)}
                  open={keyOf(folder) === keyOf(shown)}
                  isOwner={isOwner}
                  busy={pending || choices.data === undefined}
                  onOpen={() => {
                    goTo(folderIdOf(folder));
                  }}
                  onTick={(imported) => {
                    void change({
                      platformAccountId: folder.platformAccountId,
                      folders: [{ folderRef: folder.folderRef, imported }],
                      media: [],
                    });
                  }}
                />
              ))}
            </ul>
          </nav>
          <FolderPane
            key={keyOf(shown)}
            creatorId={creatorId}
            folder={shown}
            index={index}
            isOwner={isOwner}
            ready={choices.data !== undefined}
            pending={pending}
            failed={failed}
            progress={batch !== null && batch.folder === keyOf(shown) ? progress : null}
            onBack={() => {
              goTo(null);
            }}
            onChange={change}
            onAsked={(ids) => {
              setBatch({ folder: keyOf(shown), ids, askedAt: Date.now() });
              void choices.refetch();
            }}
          />
        </div>
      </>
    );
  };

  return (
    <section className="nv-plate vx-card vp" aria-label={`Coffre Reveal de ${creatorName}`}>
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
            {running ? 'Synchro en cours' : 'Synchroniser'}
          </button>
        ) : null}
      </div>
      {!isOwner ? (
        <p className="ps-muted vx-note">Seul le propriétaire synchronise, importe et fait décrire.</p>
      ) : null}
      <p className={`vx-phase vx-phase--${said?.tone ?? 'muted'}`} role="status">
        {said?.text ?? ''}
      </p>
      {body()}
    </section>
  );
}

/**
 * One folder of the rail: its import tick for the owner (a dash when some of its media only are imported), then the
 * button that opens it, with its first preview, its name as Reveal gives it and how much of it is imported.
 */
function FolderRow({
  folder,
  count,
  open,
  isOwner,
  busy,
  onOpen,
  onTick,
}: {
  folder: VaultFolderView;
  count: FolderCount;
  open: boolean;
  isOwner: boolean;
  busy: boolean;
  onOpen: () => void;
  onTick: (imported: boolean) => void;
}): JSX.Element {
  const tick = useRef<HTMLInputElement>(null);
  const name = folderName(folder);
  const first = folder.media.find((each) => !each.removed);
  useLayoutEffect(() => {
    if (tick.current !== null) tick.current.indeterminate = count.tick === 'some';
  }, [count.tick]);
  return (
    <li className="vp-folder" data-open={open ? '' : undefined} data-tick={count.tick}>
      {isOwner ? (
        <input
          ref={tick}
          type="checkbox"
          className="nv-check vp-folder__tick"
          aria-label={`Importer tout ${name}`}
          checked={count.tick === 'all'}
          aria-checked={count.tick === 'some' ? 'mixed' : count.tick === 'all'}
          disabled={busy}
          onChange={() => {
            onTick(count.tick !== 'all');
          }}
        />
      ) : null}
      <button
        type="button"
        className="vp-folder__open"
        aria-current={open ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className="vp-folder__cover" aria-hidden="true">
          {first === undefined ? (
            <FolderIcon />
          ) : first.kind === 'audio' ? (
            <VoiceFace seed={first.platformMediaId} bars={7} />
          ) : (
            <Preview hash={first.blurhash} />
          )}
        </span>
        <span className="vp-folder__text">
          <span className="vp-folder__name">
            <span className="vp-folder__label">{name}</span>
            {/* Where the others carry their ☀️ or 🌙: a folder Reveal names with neither, to rename. */}
            {folder.folderRef !== null && folder.moment === null ? (
              <span className="nv-dot nv-tone--warn" role="img" aria-label="À classer" />
            ) : null}
          </span>
          <span className="vp-folder__line nv-num">{importLine(count)}</span>
          {folder.folderRef !== null && folder.moment === null ? (
            <span className="vp-folder__warn">Ni ☀️ ni 🌙 : à renommer dans Reveal</span>
          ) : null}
        </span>
        <span className="vp-folder__chev" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
    </li>
  );
}

/** Where « Décrire par IA » stands, from the first count to the run asked. */
type Describe =
  | { readonly step: 'counting'; readonly key: string; readonly ids: readonly string[] }
  | {
      readonly step: 'shown' | 'asking';
      readonly key: string;
      readonly ids: readonly string[];
      readonly estimate: Extract<VaultDescribeAnswer, { status: 'estimate' }>;
      readonly moved: boolean;
    }
  | { readonly step: 'failed'; readonly key: string; readonly ids: readonly string[] };

/**
 * A folder open: its name and lines, « Voir net » and « Sélectionner », the filters, then its media in Reveal's order,
 * each with where its description stands under it. While selecting, the bar of actions floats under the grid.
 */
function FolderPane({
  creatorId,
  folder,
  index,
  isOwner,
  ready,
  pending,
  failed,
  progress,
  onBack,
  onChange,
  onAsked,
}: {
  creatorId: CreatorId;
  folder: VaultFolderView;
  index: ChoiceIndex;
  isOwner: boolean;
  ready: boolean;
  pending: boolean;
  failed: boolean;
  progress: { readonly done: number; readonly total: number } | null;
  onBack: () => void;
  onChange: (change: VaultChoicesChange) => Promise<boolean>;
  onAsked: (ids: readonly string[]) => void;
}): JSX.Element {
  const [filters, setFilters] = useState<ReadonlySet<VaultFilter>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [peeked, setPeeked] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [describe, setDescribe] = useState<Describe | null>(null);
  const blurred = useMediaBlur();
  const name = folderName(folder);
  const title = useRef<HTMLHeadingElement>(null);

  const unmarked = folder.folderRef !== null && folder.moment === null;
  const groups = mediaGroups(folder, index, filteredMedia(folder, index, filters));
  const shown = groups.flatMap((group) => group.media);
  const order = shown.filter(selectable).map((each) => each.platformMediaId);
  const every = order.length > 0 && order.every((id) => selected.has(id));
  const estimate = describeEstimate(folder, index, selected);
  const at = picked === null ? -1 : shown.findIndex((each) => each.platformMediaId === picked);
  const media = at < 0 ? undefined : shown[at];
  const bar = (selecting && selected.size > 0) || progress !== null;

  // A folder opened by a gesture: the reader lands on its name, not back at the page's top.
  useEffect(() => {
    if (document.activeElement?.closest('.vp-rail') !== null) title.current?.focus({ preventScroll: true });
  }, []);

  // Échap leaves the selection, when no window is open over it.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && picked === null && describe === null) {
        setSelecting(false);
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [selecting, picked, describe]);

  const press = (each: VaultMediaView, event: MouseEvent<HTMLButtonElement>): void => {
    if (!selecting) {
      setPicked(each.platformMediaId);
      return;
    }
    if (!selectable(each)) return;
    setSelected((current) =>
      event.shiftKey
        ? rangeSelected(current, order, anchor, each.platformMediaId)
        : toggled(current, each.platformMediaId),
    );
    setAnchor(each.platformMediaId);
  };

  const ticked = [...selected].filter((id) =>
    folder.media.some((each) => each.platformMediaId === id && selectable(each)),
  );
  // What « Importer » and « Retirer » would change: the media picked whose tick they would turn, said on the button.
  const turned = (imported: boolean): string[] =>
    ticked.filter((id) => {
      const each = folder.media.find((media) => media.platformMediaId === id);
      return each !== undefined && choiceOf(index, folder, each).imported !== imported;
    });
  const toImport = turned(true);
  const toRemove = turned(false);
  const tickAll = (ids: readonly string[], imported: boolean): void => {
    void onChange({
      platformAccountId: folder.platformAccountId,
      folders: [],
      media: ids.map((platformMediaId) => ({ platformMediaId, imported })),
    });
  };

  const count1 = async (ids: readonly string[]): Promise<void> => {
    const key = crypto.randomUUID();
    setDescribe({ step: 'counting', key, ids });
    const answer = await askVaultDescribe(creatorId, {
      platformAccountId: folder.platformAccountId,
      platformMediaIds: [...ids],
      confirm: null,
      idempotencyKey: key,
    });
    if (answer?.status !== 'estimate') setDescribe({ step: 'failed', key, ids });
    else setDescribe({ step: 'shown', key, ids, estimate: answer, moved: false });
  };

  const confirm = async (): Promise<void> => {
    if (describe?.step !== 'shown') return;
    setDescribe({ ...describe, step: 'asking' });
    const asked = describable(folder, index, new Set(describe.ids)).map((each) => each.platformMediaId);
    const answer = await askVaultDescribe(creatorId, {
      platformAccountId: folder.platformAccountId,
      platformMediaIds: [...describe.ids],
      confirm: { count: describe.estimate.count, costCents: describe.estimate.costCents },
      idempotencyKey: describe.key,
    });
    if (answer === null) setDescribe({ step: 'failed', key: describe.key, ids: describe.ids });
    else if (answer.status === 'estimate')
      // The count moved meanwhile (a run, another screen): nothing asked, the new count shown to confirm again.
      setDescribe({ step: 'shown', key: describe.key, ids: describe.ids, estimate: answer, moved: true });
    else {
      setDescribe(null);
      setSelected(new Set());
      onAsked(asked);
    }
  };

  return (
    <div className="vp-pane" aria-busy={!ready}>
      <div className="vp-pane__head">
        <button type="button" className="vp-back nv-tap" onClick={onBack}>
          <span className="vp-back__chev" aria-hidden="true">
            <ChevronIcon />
          </span>
          Dossiers
        </button>
        <div className="vp-pane__title">
          <h3 className="nv-h3 vp-pane__name" ref={title} tabIndex={-1}>
            <span>{name}</span>
            {unmarked ? <span className="nv-dot nv-tone--warn" role="img" aria-label="À classer" /> : null}
          </h3>
          {/* What it holds; how much of it is imported is said once, on the rail, and by the grid's groups. */}
          <p className="ps-muted vp-pane__line nv-num">{folderLine(folder.media)}</p>
          {/* The rail says it on the folder's row; on the phone the rail is gone once a folder is open. */}
          {unmarked ? <p className="vp-pane__warn">Ni ☀️ ni 🌙 : à renommer dans Reveal</p> : null}
        </div>
        <div className="vp-pane__actions">
          {isOwner && order.length > 0 ? (
            <button
              type="button"
              className={`nv-btn nv-btn--sm ${selecting ? 'nv-btn--plain' : 'nv-btn--soft'} vp-select`}
              aria-pressed={selecting}
              disabled={!ready}
              onClick={() => {
                setSelecting(!selecting);
                setSelected(new Set());
                setPeeked(new Set());
                setAnchor(null);
              }}
            >
              {selecting ? <CloseIcon /> : <SelectIcon />}
              {selecting ? 'Terminer' : 'Sélectionner'}
            </button>
          ) : null}
        </div>
      </div>
      {folder.media.length === 0 ? null : (
        <div className="vp-filters">
          <div className="vp-filters__chips" role="group" aria-label="Filtrer les médias">
            {VAULT_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                className="nv-chip"
                aria-pressed={filters.has(filter)}
                onClick={() => {
                  setFilters((current) => toggled(current, filter));
                }}
              >
                {FILTER_NAMES[filter]}
              </button>
            ))}
          </div>
          {selecting ? (
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm vp-all"
              disabled={order.length === 0}
              onClick={() => {
                setSelected((current) => allToggled(current, order));
              }}
            >
              {every ? 'Tout désélectionner' : 'Tout sélectionner dans ce dossier'}
            </button>
          ) : null}
        </div>
      )}
      {selecting ? (
        <p className="ps-muted vp-hint">
          Touche un média pour le cocher
          <span className="vp-hint__mouse">, Maj et clic pour une suite</span>. L’œil montre une image nette.
        </p>
      ) : null}
      {folder.media.length === 0 ? (
        <div className="vx-empty vp-empty">
          <p className="vx-empty__title">Dossier vide</p>
          <p className="ps-muted">Reveal n’a listé aucun média dans ce dossier à la dernière synchro.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="vx-empty vp-empty">
          <p className="vx-empty__title">Aucun média sous ces filtres</p>
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            onClick={() => {
              setFilters(new Set());
            }}
          >
            Retirer les filtres
          </button>
        </div>
      ) : (
        <ul className="vp-groups" aria-label={`Médias de ${name}`}>
          {groups.map((group, g) => {
            const first = groups.slice(0, g).reduce((sum, each) => sum + each.media.length, 0);
            return (
              <li key={group.key} className="vp-group" data-group={group.key}>
                <h4 className="vp-group__title nv-eyebrow" id={`vp-group-${group.key}`}>
                  {GROUP_NAMES[group.key]}{' '}
                  <span className="vp-group__count nv-num">{group.media.length}</span>
                </h4>
                <ul
                  className="vp-grid"
                  aria-labelledby={`vp-group-${group.key}`}
                  data-selecting={selecting ? '' : undefined}
                >
                  {group.media.map((each, at) => (
                    <li key={each.platformMediaId} className="vp-cell">
                      <MediaTile
                        creatorId={creatorId}
                        media={each}
                        rank={first + at + 1}
                        choice={choiceOf(index, folder, each)}
                        sharp={!blurred}
                        selecting={selecting}
                        selected={selected.has(each.platformMediaId)}
                        peeked={peeked.has(each.platformMediaId)}
                        onPress={(event) => {
                          press(each, event);
                        }}
                        onPeek={() => {
                          setPeeked((current) => toggled(current, each.platformMediaId));
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      {bar ? (
        <div className="vp-bar-room">
          <div className="nv-plate vp-bar" role="toolbar" aria-label="Actions sur la sélection">
            {selecting && selected.size > 0 ? (
              <div className="vp-bar__row">
                <span className="vp-bar__count nv-num" aria-live="polite">
                  {selectedLine(selected.size)}
                </span>
                <span className="vp-bar__actions">
                  {toImport.length === 0 ? null : (
                    <button
                      type="button"
                      className="nv-btn nv-btn--neon nv-btn--sm vp-bar__import"
                      disabled={pending}
                      aria-busy={pending}
                      onClick={() => {
                        tickAll(toImport, true);
                      }}
                    >
                      <CheckIcon />
                      Importer {toImport.length}
                    </button>
                  )}
                  <button
                    type="button"
                    className="nv-btn nv-btn--soft nv-btn--sm vp-describe"
                    disabled={pending || estimate.count === 0 || selected.size > DESCRIBE_AT_ONCE}
                    title={
                      estimate.count === 0
                        ? 'Rien à décrire : importe d’abord, ou c’est déjà décrit.'
                        : `${String(estimate.count)} à décrire, ≈ ${centsLine(estimate.costCents)}`
                    }
                    onClick={() => {
                      void count1([...selected]);
                    }}
                  >
                    <SparkIcon />
                    {estimate.count > 0 ? `Décrire ${String(estimate.count)} par IA` : 'Décrire par IA'}
                    {estimate.count > 0 ? ' ' : null}
                    {estimate.count > 0 ? (
                      <span className="vp-describe__cost nv-num">≈ {centsLine(estimate.costCents)}</span>
                    ) : null}
                  </button>
                  {toRemove.length === 0 ? null : (
                    // Beside « Importer », a quiet way out; alone, it carries the bar's action.
                    <button
                      type="button"
                      className={`nv-btn ${toImport.length === 0 ? 'nv-btn--soft' : 'nv-btn--plain'} nv-btn--sm vp-bar__remove`}
                      disabled={pending}
                      onClick={() => {
                        tickAll(toRemove, false);
                      }}
                    >
                      Retirer {toRemove.length} d’Impera
                    </button>
                  )}
                </span>
              </div>
            ) : null}
            {selecting && toRemove.length > 0 ? (
              <p className="vp-bar__note">Retirer d’Impera ne supprime rien dans Reveal.</p>
            ) : null}
            {selected.size > DESCRIBE_AT_ONCE ? (
              <p className="vp-bar__note">
                {DESCRIBE_AT_ONCE} médias au plus à décrire d’un coup : réduis la sélection.
              </p>
            ) : null}
            {progress === null ? null : (
              <div className="vp-progress" role="status">
                <span className="vp-progress__line nv-num">
                  <SparkIcon />
                  {progressLine(progress)}
                </span>
                <span className="vp-meter vp-meter--agent" aria-hidden="true">
                  <span
                    className="vp-meter__fill"
                    style={{ '--vp-share': progress.total === 0 ? 1 : progress.done / progress.total }}
                  />
                </span>
              </div>
            )}
            {failed ? (
              <p className="vp-bar__note vp-bar__note--warn" role="alert">
                Le choix n’a pas été enregistré : le serveur ne répond pas. Réessaie dans un instant.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {media === undefined ? null : (
        <MediaSheet
          creatorId={creatorId}
          media={media}
          rank={at + 1}
          count={shown.length}
          choice={choiceOf(index, folder, media)}
          onStep={(by) => {
            const next = shown[at + by];
            if (next !== undefined) setPicked(next.platformMediaId);
          }}
          onClose={() => {
            setPicked(null);
          }}
        />
      )}
      {describe === null ? null : (
        <DescribeDialog
          describe={describe}
          onRetry={() => {
            void count1(describe.ids);
          }}
          onConfirm={() => {
            void confirm();
          }}
          onClose={() => {
            setDescribe(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * A media of the grid: the platform's blur, sharp under the pointer outside a selection; a small ink tick once imported,
 * faded while it is not. While selecting, the whole tile ticks it and the eye in its corner shows it sharp. Under it,
 * where its description stands, two lines at most.
 */
function MediaTile({
  creatorId,
  media,
  rank,
  choice,
  sharp,
  selecting,
  selected,
  peeked,
  onPress,
  onPeek,
}: {
  creatorId: CreatorId;
  media: VaultMediaView;
  rank: number;
  choice: ReturnType<typeof choiceOf>;
  sharp: boolean;
  selecting: boolean;
  selected: boolean;
  peeked: boolean;
  onPress: (event: MouseEvent<HTMLButtonElement>) => void;
  onPeek: () => void;
}): JSX.Element {
  const [pointed, setPointed] = useState(false);
  const what = mediaKindLine(media);
  const said = descriptionLine(choice);
  const pickable = selectable(media);
  const pictured = media.kind !== 'audio' && !media.removed;
  const showSharp = selecting ? peeked : sharp || pointed;
  const state = [
    choice.imported ? 'importé' : 'non importé',
    choice.description === 'described' ? 'décrit' : null,
    media.removed ? 'retiré de Reveal' : null,
  ]
    .filter((each) => each !== null)
    .join(', ');
  return (
    <div
      className={`vp-item${choice.imported ? ' vp-item--in' : ' vp-item--out'}`}
      data-selected={selected ? '' : undefined}
    >
      <button
        type="button"
        className={`vx-tile vx-tile--${media.kind}${media.removed ? ' vx-tile--removed' : ''} vp-tile`}
        aria-pressed={selecting ? selected : undefined}
        aria-disabled={selecting && !pickable ? true : undefined}
        aria-label={`${String(rank)}. ${what}, ${state}`}
        onClick={onPress}
        onPointerEnter={() => {
          setPointed(true);
        }}
        onPointerLeave={() => {
          setPointed(false);
        }}
      >
        <span className="vp-face">
          {media.kind === 'audio' ? (
            <VoiceFace seed={media.platformMediaId} bars={14} />
          ) : (
            <>
              <Preview hash={media.blurhash} />
              {showSharp ? <Sharp creatorId={creatorId} media={media} /> : null}
            </>
          )}
        </span>
        {/* Its corner is the selection's alone: a video says itself by its length. */}
        {selecting && pickable ? <span className="vp-tick" aria-hidden="true" /> : null}
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
      {selecting && pictured ? (
        <button
          type="button"
          className="vp-peek"
          aria-label={peeked ? `Flouter le média ${String(rank)}` : `Voir net le média ${String(rank)}`}
          aria-pressed={peeked}
          onClick={onPeek}
        >
          <EyeIcon open={peeked} />
        </button>
      ) : null}
      {/* One left edge for every caption, its room kept even when silent: not imported and never asked, its group
          says it. Full ink for a description, grey for a state, amber when the AI cannot read it. */}
      <p className={`vp-caption vp-caption--${said.tone}`}>
        {!choice.imported && choice.description === 'none' ? null : <span>{said.text}</span>}
      </p>
    </div>
  );
}

/**
 * « Décrire par IA », said before it starts (ADR 0145 § 5): how many, what it costs, what is left of today's AI cap, and
 * what of the selection is left out and why, never counted twice. Nothing starts without « Décrire ».
 */
function DescribeDialog({
  describe,
  onRetry,
  onConfirm,
  onClose,
}: {
  describe: Describe;
  onRetry: () => void;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  const busy = describe.step === 'counting' || describe.step === 'asking';
  const body = (): JSX.Element => {
    if (describe.step === 'counting')
      return <div className="ps-skeleton vp-dialog__skeleton" aria-busy="true" aria-label="Calcul du coût" />;
    if (describe.step === 'failed')
      return (
        <>
          <p className="tm-warn" role="alert">
            Le coût n’a pas pu être calculé : rien n’est lancé. Réessaie dans un instant.
          </p>
          <div className="tm-dialog__foot">
            <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
              Fermer
            </button>
            <button type="button" className="nv-btn nv-btn--soft" onClick={onRetry}>
              Réessayer
            </button>
          </div>
        </>
      );
    const { estimate } = describe;
    const over = estimate.costCents > estimate.capLeftCents;
    const left = [
      [estimate.alreadyDescribed, 'déjà décrit, pas recompté', 'déjà décrits, pas recomptés'],
      [estimate.alreadyAsked, 'déjà demandé, en cours', 'déjà demandés, en cours'],
      [estimate.notImported, 'non importé : importe-le d’abord', 'non importés : importe-les d’abord'],
      [
        estimate.notDescribable,
        'non descriptible (vocal, retiré, ou laissé à l’agence)',
        'non descriptibles (vocaux, retirés, ou laissés à l’agence)',
      ],
    ] as const;
    const kinds = [
      estimate.photos > 0 ? `${String(estimate.photos)} ${estimate.photos === 1 ? 'photo' : 'photos'}` : null,
      estimate.videos > 0 ? `${String(estimate.videos)} ${estimate.videos === 1 ? 'vidéo' : 'vidéos'}` : null,
    ].filter((each) => each !== null);
    return (
      <>
        {describe.moved ? (
          <p className="tm-warn" role="alert">
            Le compte a changé depuis : vérifie avant de confirmer.
          </p>
        ) : null}
        {estimate.count === 0 ? (
          <p className="vp-dialog__none">Rien à décrire dans cette sélection.</p>
        ) : (
          <div className="vp-dialog__figures">
            <div className="vp-dialog__figure">
              <span className="nv-eyebrow">À décrire</span>
              <span className="vp-dialog__value nv-num">{estimate.count}</span>
              <span className="ps-muted nv-num">{kinds.join(' · ')}</span>
            </div>
            <div className="vp-dialog__figure vp-dialog__figure--cost">
              <span className="nv-eyebrow">Coût estimé</span>
              <span className="vp-dialog__value nv-num">≈ {centsLine(estimate.costCents)}</span>
              <span className={`nv-num ${over ? 'vp-dialog__over' : 'ps-muted'}`}>
                Reste du plafond du jour : {centsLine(estimate.capLeftCents)}
              </span>
            </div>
          </div>
        )}
        {left.some(([count]) => count > 0) ? (
          <ul className="vp-dialog__left">
            {left
              .filter(([count]) => count > 0)
              .map(([count, one, many]) => (
                <li key={one} className="nv-num">
                  {count} {count === 1 ? one : many}
                </li>
              ))}
          </ul>
        ) : null}
        {over ? (
          <p className="tm-warn">
            Ce coût dépasse ce qui reste du plafond IA du jour : réduis la sélection, ou attends demain.
          </p>
        ) : null}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            {estimate.count === 0 ? 'Fermer' : 'Annuler'}
          </button>
          {estimate.count === 0 ? null : (
            <button
              type="button"
              className="nv-btn nv-btn--neon"
              data-autofocus=""
              disabled={busy || over}
              aria-busy={describe.step === 'asking'}
              onClick={onConfirm}
            >
              <SparkIcon />
              {describe.step === 'asking'
                ? 'Lancement…'
                : `Décrire ${String(estimate.count)} · ≈ ${centsLine(estimate.costCents)}`}
            </button>
          )}
        </div>
      </>
    );
  };
  return (
    <Dialog
      title="Décrire par IA"
      lead="L’IA regarde chaque média et écrit ce qu’il montre : l’agent de chatting le sait ensuite sans le voir."
      busy={busy}
      className="vp-dialog"
      onClose={onClose}
    >
      <div className="tm-dialog__body">{body()}</div>
    </Dialog>
  );
}
