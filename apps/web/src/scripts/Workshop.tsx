import {
  SCRIPT_COLOR_PRESETS,
  SCRIPT_SEGMENTS_MAX,
  SCRIPT_STRUCTURE_NAME_MAX,
  type ScriptCardPreviewBody,
  type ScriptMoment,
  type ScriptSegment,
  type ScriptStructure,
  type ScriptStructureId,
  type ScriptVariantLetter,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { Counts, SegmentEditor } from './SegmentEditor';
import { saveStructure, structuresKey, type SaveResult } from './api';
import { ScIcon } from './icons';
import {
  addBridgeAfter,
  addStage,
  canBridgeAfter,
  flat,
  inkOf,
  issuesOf,
  move,
  presetOf,
  remove,
  replace,
  segmentTitles,
  stackSummary,
  type Draft,
  scriptGradient,
} from './model';
import { useDragSort } from './useDragSort';
import { useFlip } from './useFlip';
import { usePreview } from './usePreview';

import { Segment } from '@/creators/persona/fields';

export interface WorkshopStart {
  readonly id: ScriptStructureId;
  readonly draft: Draft;
  /** The version read, or `null` for a structure not yet written. */
  readonly basedOnVersion: number | null;
  /** Already asked of a creator: saving writes the next version, the one asked stays as it was. */
  readonly frozen: boolean;
}

const MOMENTS: readonly { value: ScriptMoment; label: string }[] = [
  { value: 'day', label: 'Jour' },
  { value: 'night', label: 'Nuit' },
  { value: 'both', label: 'Jour et nuit' },
];

const SAVE_PROBLEMS: Record<Exclude<SaveResult['kind'], 'saved' | 'invalid'>, string> = {
  stale:
    'Une autre version a été enregistrée entre-temps. Recharge la structure pour repartir de la dernière.',
  conflict: 'Cette structure existe déjà avec un autre contenu. Recharge la page.',
  expired: 'Ta session a pris fin. Reconnecte-toi, ta structure reste à l’écran.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant, rien n’est perdu.',
};

/** Where the stack, the card and the sheet stand one under the other (`structures.css`). */
const NARROW = '(max-width: 860px)';

/**
 * The workshop of one structure (SC-01 lot c, ADR 0056 and 0064): its name, its moment, its colour, its stack of stages
 * and bridges, and beside it the card of the segment being written, drawn by the server as the creator will get it.
 * The screen refuses what the server would, at the same place; nothing is stored before « Enregistrer ».
 */
export function Workshop({
  start,
  onClose,
  onDirty,
}: {
  start: WorkshopStart;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}): JSX.Element {
  const id = useId();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(start.draft);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [saved, setSaved] = useState<Draft>(start.draft);
  const [basedOn, setBasedOn] = useState(start.basedOnVersion);
  const [frozen, setFrozen] = useState(start.frozen);
  const [selected, setSelected] = useState(start.draft.segments[0]?.key ?? '');
  const [variant, setVariant] = useState<ScriptVariantLetter | null>(null);
  const [saving, setSaving] = useState(false);
  const sending = useRef(false);
  const previewRef = useRef<HTMLElement>(null);
  const flowRef = useRef<HTMLOListElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customColor, setCustomColor] = useState(presetOf(start.draft.color) === null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(
    () => () => {
      onDirty(false);
    },
    [onDirty],
  );

  const issues = useMemo(() => issuesOf(draft), [draft]);
  useFlip(flowRef, draft.segments.map((segment) => segment.key).join(' '));
  const sort = useDragSort(flowRef, (key, delta) => {
    const at = draftRef.current.segments.findIndex((segment) => segment.key === key);
    if (at === -1) return;
    const next = move(draftRef.current.segments, at, delta);
    draftRef.current = { ...draftRef.current, segments: next };
    segments(next, key);
  });
  const titles = useMemo(() => segmentTitles(draft.segments), [draft.segments]);
  const index = Math.max(
    0,
    draft.segments.findIndex((segment) => segment.key === selected),
  );
  const current = draft.segments[index];
  const ink = inkOf(draft.color);

  const segments = (next: ScriptSegment[], select?: string): void => {
    setDraft({ ...draft, segments: next });
    setNotice(null);
    if (select !== undefined) {
      setSelected(select);
      setVariant(null);
    } else if (!next.some((segment) => segment.key === selected)) {
      setSelected(next[Math.min(index, next.length - 1)]?.key ?? '');
      setVariant(null);
    }
  };
  const edit = (patch: Partial<Draft>): void => {
    setDraft({ ...draft, ...patch });
    setNotice(null);
  };

  const preview = (format: ScriptCardPreviewBody['format']): ScriptCardPreviewBody | null =>
    current === undefined
      ? null
      : {
          name: draft.name.trim() === '' ? 'Sans nom' : draft.name,
          moment: draft.moment,
          color: draft.color,
          segments: draft.segments,
          segmentKey: current.key,
          ...(variant === null || current.kind !== 'stage' ? {} : { variant }),
          format,
        };
  const card = usePreview(preview('card'));
  const thumbnail = usePreview(preview('thumbnail'));

  const blocked = issues.size > 0 ? 'Corrige d’abord ce qui est signalé.' : null;

  async function save(): Promise<void> {
    if (blocked !== null || sending.current) return;
    sending.current = true;
    setSaving(true);
    setProblem(null);
    const result = await saveStructure(start.id, draft, basedOn);
    sending.current = false;
    setSaving(false);
    if (result.kind === 'saved') {
      const structure: ScriptStructure = result.structure;
      setBasedOn(structure.current.version);
      setFrozen(structure.current.frozen);
      setSaved(draft);
      setNotice(`Enregistrée, version ${String(structure.current.version)}.`);
      await queryClient.invalidateQueries({ queryKey: structuresKey });
      return;
    }
    setProblem(result.kind === 'invalid' ? result.message : SAVE_PROBLEMS[result.kind]);
  }

  /** Opens a segment's sheet; on a phone the card and the sheet sit under the whole stack, so a tap leads there. */
  const select = (key: string, follow = true): void => {
    setSelected(key);
    setVariant(null);
    setNotice(null);
    if (follow && window.matchMedia(NARROW).matches) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      previewRef.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    }
  };

  /** Alt + ↑ / ↓ moves the stage or the bridge under the focus, as its two buttons do. */
  const onRowKey = (event: KeyboardEvent, at: number): void => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const key = draft.segments[at]?.key;
    segments(move(draft.segments, at, event.key === 'ArrowUp' ? -1 : 1), key);
  };

  const issueCount = [...issues.values()].flat().length;
  const state: { tone: 'warn' | 'dirty' | 'ok'; text: string } =
    notice !== null
      ? { tone: 'ok', text: notice }
      : blocked !== null
        ? { tone: 'warn', text: `${String(issueCount)} point${issueCount > 1 ? 's' : ''} à corriger` }
        : dirty
          ? { tone: 'dirty', text: 'Modifications non enregistrées' }
          : basedOn === null
            ? { tone: 'dirty', text: 'Pas encore enregistrée' }
            : { tone: 'ok', text: 'Tout est enregistré' };
  const presetName =
    SCRIPT_COLOR_PRESETS.find((preset) => preset.key === presetOf(draft.color))?.name ?? null;

  const headIssues = [
    ...(issues.get('name') ?? []),
    ...(issues.get('color') ?? []),
    ...(issues.get('') ?? []),
  ];

  return (
    <section className="ps-page st-workshop" aria-label="Atelier de la structure">
      <div className="nv-glass nv-glass--thin st-bar">
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm st-bar__back" onClick={onClose}>
          ← Structures
        </button>
        <span
          className="st-bar__chip"
          style={{ background: scriptGradient(draft.color) }}
          aria-hidden="true"
        />
        <label className="sr-only" htmlFor={`${id}-name`}>
          Nom de la structure
        </label>
        <input
          id={`${id}-name`}
          className="st-bar__name"
          value={draft.name}
          maxLength={SCRIPT_STRUCTURE_NAME_MAX}
          placeholder="Nom de la structure"
          aria-invalid={draft.name.trim() === '' ? true : undefined}
          onChange={(event) => {
            edit({ name: event.target.value });
          }}
        />
        <span className="st-bar__state" data-state={state.tone} aria-live="polite">
          <span className="ps-dot" data-dot={state.tone === 'warn' ? 'warn' : 'ok'} />
          {state.text}
        </span>
        <button
          type="button"
          className="nv-btn nv-btn--neon nv-btn--sm"
          disabled={blocked !== null || saving || (!dirty && basedOn !== null)}
          title={blocked ?? undefined}
          aria-busy={saving}
          onClick={() => void save()}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
      {frozen || headIssues.length > 0 || problem !== null ? (
        <div className="st-notes">
          {frozen ? (
            <p className="ps-hint">
              Cette version est déjà demandée à une créatrice : l’enregistrement en écrit une nouvelle, la
              sienne ne change pas.
            </p>
          ) : null}
          {headIssues.map((issue) => (
            <p key={issue} className="ps-error">
              {issue}
            </p>
          ))}
          {problem === null ? null : (
            <p className="ps-error" role="alert">
              {problem}
            </p>
          )}
        </div>
      ) : null}

      <div className="nv-plate st-look">
        <div className="st-look__moment">
          <span className="nv-field__label">Moment</span>
          <Segment
            label="Moment"
            value={draft.moment}
            options={MOMENTS}
            onChange={(moment) => {
              edit({ moment });
            }}
          />
          <span className="ps-hint">Soleil, lune, ou les deux en haut de chaque carton.</span>
        </div>
        <fieldset className="st-fieldset st-look__color">
          <legend className="nv-field__label st-look__legend">
            Couleur du script
            <span className="st-look__picked">{customColor ? 'Libre' : (presetName ?? 'Libre')}</span>
            <button
              type="button"
              className="st-pill st-look__free"
              aria-pressed={customColor}
              onClick={() => {
                setCustomColor(!customColor);
              }}
            >
              Couleur libre
            </button>
          </legend>
          <div className="st-swatches" role="radiogroup" aria-label="Couleur du script">
            {SCRIPT_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                role="radio"
                className="st-swatch"
                aria-checked={!customColor && presetOf(draft.color) === preset.key}
                title={preset.name}
                aria-label={preset.name}
                style={{ background: scriptGradient(preset.color) }}
                onClick={() => {
                  setCustomColor(false);
                  edit({ color: preset.color });
                }}
              />
            ))}
          </div>
          {customColor ? (
            <div className="st-free">
              <span
                className="st-free__bar"
                style={{ background: scriptGradient(draft.color) }}
                aria-hidden="true"
              />
              <div className="st-free__tones">
                {(['primary', 'secondary', 'accent'] as const).map((tone, at) => (
                  <label key={tone} className="st-free__tone">
                    <input
                      type="color"
                      value={draft.color[tone]}
                      onChange={(event) => {
                        edit({ color: { ...draft.color, [tone]: event.target.value } });
                      }}
                    />
                    <span>
                      {['Début', 'Milieu', 'Fin'][at]}
                      <span className="st-free__hex">{draft.color[tone]}</span>
                    </span>
                  </label>
                ))}
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  onClick={() => {
                    edit({ color: flat(draft.color.primary) });
                  }}
                >
                  Couleur unie
                </button>
              </div>
            </div>
          ) : null}
          {ink === null ? (
            <p className="ps-error" role="alert">
              Aucune encre ne se lit sur cette couleur : prends-la plus claire ou plus foncée.
            </p>
          ) : (
            <p className="ps-hint">
              {`Texte des cartons en ${ink === '#ffffff' ? 'blanc' : 'encre foncée'}, choisi pour se lire partout.`}
            </p>
          )}
        </fieldset>
      </div>

      <div className="st-columns">
        <div
          className="nv-plate ps-panel st-stack"
          style={{
            '--st-accent': draft.color.primary,
            '--st-ink': inkOf(flat(draft.color.primary)) ?? '#ffffff',
          }}
        >
          <div className="st-stack__head">
            <p className="nv-eyebrow">Ordre de vente</p>
            <span className="st-stack__sum">{stackSummary(draft.segments)}</span>
          </div>
          <ol className="st-flow" ref={flowRef}>
            {draft.segments.map((segment, at) => {
              const wrong = issues.has(segment.key);
              const title = titles.get(segment.key) ?? '';
              const here = segment.key === current?.key;
              const number = draft.segments.slice(0, at + 1).filter((s) => s.kind === 'stage').length;
              return (
                <Fragment key={segment.key}>
                  <li
                    className="st-flow__item nv-enter"
                    data-flip={segment.key}
                    data-sort={segment.key}
                    data-dragging={sort.dragging === segment.key}
                    data-kind={segment.kind}
                    data-current={here}
                    style={{ '--nv-i': Math.min(at, 12), ...sort.styleOf(segment.key) }}
                    {...sort.press(segment.key)}
                  >
                    <span
                      className="st-flow__rail"
                      aria-hidden="true"
                      title="Glisser pour déplacer"
                      data-sort-handle=""
                    >
                      <span className="st-flow__node">{segment.kind === 'stage' ? number : null}</span>
                    </span>
                    <div className="st-step">
                      <button
                        type="button"
                        className="st-step__main"
                        aria-current={here ? 'true' : undefined}
                        aria-label={`${title} : ${segment.kind === 'stage' ? segment.name || 'sans nom' : segment.teaser || 'sans teaser'}`}
                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                        onClick={() => {
                          select(segment.key);
                        }}
                        onKeyDown={(event) => {
                          onRowKey(event, at);
                        }}
                      >
                        {segment.kind === 'stage' ? (
                          <>
                            <span className="st-step__top">
                              <span className="st-step__name">{segment.name || 'Sans nom'}</span>
                              <span className="st-access" data-access={segment.access}>
                                {segment.access === 'paid' ? 'Payant' : 'Gratuit'}
                              </span>
                              {wrong ? (
                                <span className="ps-dot" data-dot="warn" aria-label="À corriger" />
                              ) : null}
                            </span>
                            <span className="st-step__sub">
                              <Counts slots={segment.mediaSlots} />
                              {segment.variants.length > 0 ? (
                                <span className="st-step__series">
                                  {segment.variants.map((v) => (
                                    <span key={v.letter} className="st-step__letter">
                                      {v.letter}
                                    </span>
                                  ))}
                                </span>
                              ) : null}
                            </span>
                          </>
                        ) : (
                          <span className="st-step__bridge">
                            <span className="st-step__code">{title}</span>
                            <span className="st-step__teaser">{segment.teaser || 'Sans teaser'}</span>
                            {wrong ? (
                              <span className="ps-dot" data-dot="warn" aria-label="À corriger" />
                            ) : null}
                          </span>
                        )}
                      </button>
                      <span className="st-step__tools">
                        <button
                          type="button"
                          className="st-tool"
                          aria-label={`Monter ${title}`}
                          title="Monter (Alt + ↑)"
                          disabled={at === 0}
                          onClick={() => {
                            segments(move(draft.segments, at, -1), segment.key);
                          }}
                        >
                          <ScIcon name="up" />
                        </button>
                        <button
                          type="button"
                          className="st-tool"
                          aria-label={`Descendre ${title}`}
                          title="Descendre (Alt + ↓)"
                          disabled={at === draft.segments.length - 1}
                          onClick={() => {
                            segments(move(draft.segments, at, 1), segment.key);
                          }}
                        >
                          <ScIcon name="down" />
                        </button>
                        <button
                          type="button"
                          className="st-tool st-tool--danger"
                          aria-label={`Retirer ${title}`}
                          title="Retirer"
                          disabled={
                            segment.kind === 'stage' &&
                            draft.segments.filter((other) => other.kind === 'stage').length === 1
                          }
                          onClick={() => {
                            segments(remove(draft.segments, at));
                          }}
                        >
                          <ScIcon name="close" />
                        </button>
                      </span>
                    </div>
                  </li>
                  {canBridgeAfter(draft.segments, at) ? (
                    <li className="st-flow__gap" data-flip={`${segment.key}+gap`}>
                      <span className="st-flow__rail" aria-hidden="true" />
                      <button
                        type="button"
                        className="st-flow__bridge"
                        onClick={() => {
                          const next = addBridgeAfter(draft.segments, at);
                          segments(next, next[at + 1]?.key);
                        }}
                      >
                        <ScIcon name="plus" size={14} />
                        {`Pont entre l’étape ${String(number)} et la ${String(number + 1)}`}
                      </button>
                    </li>
                  ) : null}
                </Fragment>
              );
            })}
            <li className="st-flow__item st-flow__item--add">
              <span className="st-flow__rail" aria-hidden="true">
                <span className="st-flow__node">
                  <ScIcon name="plus" size={14} />
                </span>
              </span>
              <button
                type="button"
                className="st-flow__add"
                disabled={draft.segments.length >= SCRIPT_SEGMENTS_MAX}
                onClick={() => {
                  const next = addStage(draft.segments, null);
                  segments(next, next.at(-1)?.key);
                }}
              >
                Ajouter une étape
              </button>
            </li>
          </ol>
        </div>

        <div className="nv-plate ps-panel st-editor">
          {current === undefined ? null : (
            <>
              <SegmentEditor
                key={current.key}
                segment={current}
                title={titles.get(current.key) ?? ''}
                variant={variant}
                onVariant={setVariant}
                onChange={(next) => {
                  segments(replace(draft.segments, index, next));
                }}
              />
              {(issues.get(current.key) ?? []).length === 0 ? null : (
                <ul className="st-issues">
                  {(issues.get(current.key) ?? []).map((issue) => (
                    <li key={issue} className="ps-error">
                      {issue}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <aside className="st-preview" aria-label="Aperçu du carton" ref={previewRef}>
          <div className="st-preview__head">
            <button
              type="button"
              className="st-tool"
              aria-label="Carton précédent"
              disabled={index === 0}
              onClick={() => {
                select(draft.segments[index - 1]?.key ?? selected, false);
              }}
            >
              <ScIcon name="prev" />
            </button>
            <span className="st-preview__where">
              <span className="st-preview__title">{titles.get(current?.key ?? '') ?? ''}</span>
              <span className="st-preview__count">{`${String(index + 1)} sur ${String(draft.segments.length)}`}</span>
            </span>
            <button
              type="button"
              className="st-tool"
              aria-label="Carton suivant"
              disabled={index >= draft.segments.length - 1}
              onClick={() => {
                select(draft.segments[index + 1]?.key ?? selected, false);
              }}
            >
              <ScIcon name="next" />
            </button>
          </div>
          {current?.kind === 'stage' && current.variants.length > 0 ? (
            <div className="st-preview__series" role="group" aria-label="Série montrée">
              {current.variants.map((series) => (
                <button
                  key={series.letter}
                  type="button"
                  className="st-preview__chip"
                  aria-pressed={variant === series.letter}
                  onClick={() => {
                    setVariant(variant === series.letter ? null : series.letter);
                  }}
                >
                  {`Série ${series.letter}`}
                </button>
              ))}
            </div>
          ) : null}
          <div className="st-preview__card">
            {card.src === null ? (
              <div className="st-preview__empty ps-skeleton" />
            ) : (
              <img
                key={card.src}
                className="st-preview__img"
                src={card.src}
                alt={`Carton de ${titles.get(current?.key ?? '') ?? 'l’étape'}${variant === null ? '' : `, série ${variant}`}`}
                width={1080}
                height={1080}
              />
            )}
          </div>
          <p className="ps-hint" aria-live="polite">
            {card.waiting
              ? 'L’aperçu attend qu’un champ soit rempli.'
              : 'Le carton que reçoit la créatrice, tel que le serveur le dessine.'}
          </p>
          <div className="st-preview__thumb">
            {thumbnail.src === null ? null : (
              <img src={thumbnail.src} alt="Vignette des chatteurs" width={160} height={160} />
            )}
            <p className="ps-hint">La vignette des chatteurs : l’étape, ce qu’il y a, gratuit ou payant.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
