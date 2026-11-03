import {
  SCRIPT_QUEUE_MAX,
  type CreatorId,
  type CreatorSummary,
  type ScriptMoment,
  type ScriptQueue,
  type ScriptQueueRefusals,
  type ScriptStructure,
  type ScriptStructureId,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { queueKey, saveQueue, useQueue, type QueueSaveResult } from './api';
import { ScIcon } from './icons';
import { scriptGradient } from './model';
import { useDragSort } from './useDragSort';
import { useFlip } from './useFlip';

const MOMENT_LABELS: Record<ScriptMoment, string> = { day: 'Jour', night: 'Nuit', both: 'Jour et nuit' };

/** The time a drag or a run of clicks has to settle before the queue is written. */
const SETTLE_MS = 450;

const PROBLEMS: Record<Exclude<QueueSaveResult['kind'], 'saved' | 'blocked'>, string> = {
  unprocessable:
    'Une structure n’existe plus, ou elle est gardée pour une autre créatrice. La file est revenue à son dernier état.',
  expired: 'Ta session a pris fin. Reconnecte-toi, puis recommence.',
  failed: 'Le serveur ne répond pas. La file est revenue à son dernier état, réessaie dans un instant.',
};

function move<T>(list: readonly T[], from: number, delta: -1 | 1): T[] {
  const to = from + delta;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/**
 * Each creator's queue of structures (SC-01 lot c3, ADR 0056 § 2): the structures to ask of her next, in order. A
 * change is written as soon as it settles; a structure with a stage that touches her limits is refused by the server
 * and shown where it stands, with the stage and her persona's entry, and the queue comes back to what was stored.
 */
export function Queues({
  creators,
  structures,
}: {
  creators: readonly CreatorSummary[];
  structures: readonly ScriptStructure[];
}): JSX.Element {
  const [who, setWho] = useState<CreatorId | null>(creators[0]?.id ?? null);
  const creator = creators.find((one) => one.id === who) ?? null;
  if (creators.length === 0 || creator === null) {
    return (
      <div className="nv-plate ps-panel">
        <p className="ps-muted">Aucune créatrice encore : la file se range dès qu’il y en a une.</p>
      </div>
    );
  }
  return (
    <div className="st-queues">
      <nav className="nv-plate st-queues__who" aria-label="Créatrices">
        {creators.map((one) => (
          <button
            key={one.id}
            type="button"
            className="st-who"
            aria-current={one.id === creator.id ? 'true' : undefined}
            onClick={() => {
              setWho(one.id);
            }}
          >
            <span className="st-who__initial" aria-hidden="true">
              {one.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="st-who__name">{one.displayName}</span>
          </button>
        ))}
      </nav>
      <Queue key={creator.id} creator={creator} structures={structures} />
    </div>
  );
}

function Queue({
  creator,
  structures,
}: {
  creator: CreatorSummary;
  structures: readonly ScriptStructure[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const stored = useQueue(creator.id);
  const [order, setOrder] = useState<ScriptStructureId[] | null>(null);
  const [refusals, setRefusals] = useState<ScriptQueueRefusals['refusals']>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const ids = order ?? stored.data?.entries.map((entry) => entry.structureId) ?? [];
  const orderRef = useRef(ids);
  orderRef.current = ids;
  useFlip(listRef, ids.join(' '));
  // Leaving her queue (another creator, the library) while a change waits writes it now: never lost in silence.
  const flush = useRef<() => void>(() => undefined);
  useEffect(
    () => () => {
      if (timer.current === null) return;
      clearTimeout(timer.current);
      timer.current = null;
      flush.current();
    },
    [],
  );

  const byId = new Map(structures.map((structure) => [structure.id, structure]));
  const entries = new Map((stored.data?.entries ?? []).map((entry) => [entry.structureId, entry]));
  const refused = new Map(refusals.map((refusal) => [refusal.structureId, refusal.blocks]));

  async function write(next: readonly ScriptStructureId[]): Promise<void> {
    setSaving(true);
    const result = await saveQueue(creator.id, next);
    setSaving(false);
    // A later change is already waiting: its own write will answer.
    if (orderRef.current.join(' ') !== next.join(' ')) return;
    if (result.kind === 'saved') {
      queryClient.setQueryData<ScriptQueue>(queueKey(creator.id), result.queue);
      setOrder(null);
      setRefusals([]);
      setProblem(null);
      return;
    }
    setOrder(null);
    if (result.kind === 'blocked') {
      setRefusals(result.refusals);
      setProblem(null);
      return;
    }
    setProblem(PROBLEMS[result.kind]);
  }

  flush.current = () => {
    const next = orderRef.current;
    void saveQueue(creator.id, next).then(async (result) => {
      await queryClient.invalidateQueries({ queryKey: queueKey(creator.id) });
      return result;
    });
  };

  const change = (next: ScriptStructureId[], now = false): void => {
    setOrder(next);
    orderRef.current = next;
    setProblem(null);
    if (timer.current !== null) clearTimeout(timer.current);
    if (now) void write(next);
    else {
      timer.current = setTimeout(() => {
        timer.current = null;
        void write(orderRef.current);
      }, SETTLE_MS);
    }
  };

  const sort = useDragSort(listRef, (key, delta) => {
    const at = orderRef.current.findIndex((id) => id === key);
    if (at !== -1) change(move(orderRef.current, at, delta));
  });
  const onKey = (event: KeyboardEvent, at: number): void => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    change(move(ids, at, event.key === 'ArrowUp' ? -1 : 1));
  };

  // What can join her queue: the library's structures not in it, kept for no one or for her.
  const addable = structures.filter(
    (structure) =>
      !ids.includes(structure.id) &&
      (structure.reservedCreatorId === null || structure.reservedCreatorId === creator.id),
  );
  // Refused on the way in: shown in the library row, the queue untouched.
  const refusedOutside = refusals.filter((refusal) => !ids.includes(refusal.structureId));
  const full = ids.length >= SCRIPT_QUEUE_MAX;

  if (stored.isError) {
    return (
      <div className="nv-plate ps-panel st-queue">
        <p className="ps-title">Sa file ne se charge pas</p>
        <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
        <button
          type="button"
          className="nv-btn nv-btn--soft ps-self-start"
          onClick={() => void stored.refetch()}
        >
          Réessayer
        </button>
      </div>
    );
  }
  if (stored.data === undefined) {
    return <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall st-queue" aria-busy="true" />;
  }

  return (
    <div className="nv-plate ps-panel st-queue">
      <header className="st-queue__head">
        <div>
          <p className="nv-eyebrow">File de {creator.displayName}</p>
          <h2 className="st-queue__title">Ce qu’on lui demandera, dans l’ordre</h2>
        </div>
        <span className="st-queue__state" aria-live="polite">
          {saving ? (
            <>
              <span className="ps-dot" data-dot="ok" /> Enregistrement…
            </>
          ) : stored.data.personaChecked ? (
            <>
              <span className="ps-dot" data-dot="ok" /> Ses limites sont vérifiées
            </>
          ) : (
            <span className="st-queue__warn">
              <span className="ps-dot" data-dot="warn" /> Pas de persona active : ses limites ne sont pas
              vérifiées
            </span>
          )}
        </span>
      </header>
      {problem === null ? null : (
        <p className="ps-error" role="alert">
          {problem}
        </p>
      )}
      {refused.size > 0 && refusedOutside.length < refusals.length ? (
        <p className="ps-error" role="alert">
          Une structure de sa file touche désormais une limite de sa persona. Retire-la avant de changer
          l’ordre.
        </p>
      ) : null}

      {ids.length === 0 ? (
        <p className="ps-muted st-queue__empty">
          Rien dans sa file. Ajoute une structure de la bibliothèque.
        </p>
      ) : (
        <ol className="st-qlist" ref={listRef}>
          {ids.map((id, at) => {
            const structure = byId.get(id);
            const entry = entries.get(id);
            const blocks = refused.get(id) ?? entry?.blocks ?? [];
            const name = entry?.name ?? structure?.current.name ?? 'Structure';
            return (
              <li
                key={id}
                className="st-qrow nv-enter"
                data-flip={id}
                data-sort={id}
                data-dragging={sort.dragging === id}
                data-blocked={blocks.length > 0}
                style={{ '--nv-i': Math.min(at, 12), ...sort.styleOf(id) }}
                {...sort.press(id)}
              >
                <span className="st-qrow__rank" data-sort-handle="" title="Glisser pour déplacer">
                  {at + 1}
                </span>
                <span
                  className="st-qrow__chip"
                  aria-hidden="true"
                  style={
                    structure === undefined
                      ? undefined
                      : { background: scriptGradient(structure.current.color) }
                  }
                />
                <span
                  className="st-qrow__text"
                  role="group"
                  tabIndex={0}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  aria-label={`${String(at + 1)}. ${name}`}
                  onKeyDown={(event) => {
                    onKey(event, at);
                  }}
                >
                  <span className="st-qrow__name">{name}</span>
                  <span className="st-qrow__sub">
                    {`${MOMENT_LABELS[entry?.moment ?? structure?.current.moment ?? 'both']} · version ${String(entry?.version ?? structure?.current.version ?? 1)}`}
                  </span>
                  {blocks.map((block) => (
                    <span key={`${block.key}-${block.term}`} className="st-qrow__block">
                      {`« ${block.stageName} » touche « ${block.term} » dans sa persona`}
                    </span>
                  ))}
                </span>
                <span className="st-step__tools st-qrow__tools">
                  <button
                    type="button"
                    className="st-tool"
                    aria-label={`Monter ${name}`}
                    title="Monter (Alt + ↑)"
                    disabled={at === 0}
                    onClick={() => {
                      change(move(ids, at, -1));
                    }}
                  >
                    <ScIcon name="up" />
                  </button>
                  <button
                    type="button"
                    className="st-tool"
                    aria-label={`Descendre ${name}`}
                    title="Descendre (Alt + ↓)"
                    disabled={at === ids.length - 1}
                    onClick={() => {
                      change(move(ids, at, 1));
                    }}
                  >
                    <ScIcon name="down" />
                  </button>
                  <button
                    type="button"
                    className="st-tool st-tool--danger"
                    aria-label={`Retirer ${name} de sa file`}
                    title="Retirer de sa file"
                    onClick={() => {
                      change(
                        ids.filter((other) => other !== id),
                        true,
                      );
                    }}
                  >
                    <ScIcon name="close" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="st-queue__add">
        <p className="nv-eyebrow">Ajouter à sa file</p>
        {addable.length === 0 ? (
          <p className="ps-muted">Toute la bibliothèque est déjà dans sa file.</p>
        ) : (
          <ul className="st-picks">
            {addable.map((structure) => {
              const blocks = refusals.find((refusal) => refusal.structureId === structure.id)?.blocks ?? [];
              return (
                <li key={structure.id} className="st-pick" data-blocked={blocks.length > 0}>
                  <button
                    type="button"
                    className="st-pick__button"
                    disabled={full || saving}
                    aria-label={`Ajouter ${structure.current.name} à sa file`}
                    onClick={() => {
                      change([...ids, structure.id], true);
                    }}
                  >
                    <span
                      className="st-qrow__chip"
                      aria-hidden="true"
                      style={{ background: scriptGradient(structure.current.color) }}
                    />
                    <span className="st-pick__name">{structure.current.name}</span>
                    <ScIcon name="plus" size={15} />
                  </button>
                  {blocks.map((block) => (
                    <span key={`${block.key}-${block.term}`} className="st-qrow__block">
                      {`Refusée : « ${block.stageName} » touche « ${block.term} » dans sa persona`}
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
        {full ? (
          <p className="ps-hint">{`${String(SCRIPT_QUEUE_MAX)} structures au plus dans une file.`}</p>
        ) : null}
      </div>
    </div>
  );
}
