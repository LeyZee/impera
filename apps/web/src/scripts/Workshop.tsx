import {
  SCRIPT_COLOR_PRESETS,
  SCRIPT_STRUCTURE_NAME_MAX,
  type ScriptCardPreviewBody,
  type ScriptColor,
  type ScriptMoment,
  type ScriptSegment,
  type ScriptStructure,
  type ScriptStructureId,
  type ScriptVariantLetter,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { SegmentEditor } from './SegmentEditor';
import { saveStructure, structuresKey, type SaveResult } from './api';
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
  slotsSummary,
  type Draft,
} from './model';
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

const gradient = (color: ScriptColor): string =>
  `linear-gradient(135deg, ${color.primary}, ${color.secondary} 55%, ${color.accent})`;

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
  const [saved, setSaved] = useState<Draft>(start.draft);
  const [basedOn, setBasedOn] = useState(start.basedOnVersion);
  const [frozen, setFrozen] = useState(start.frozen);
  const [selected, setSelected] = useState(start.draft.segments[0]?.key ?? '');
  const [variant, setVariant] = useState<ScriptVariantLetter | null>(null);
  const [saving, setSaving] = useState(false);
  const sending = useRef(false);
  const previewRef = useRef<HTMLElement>(null);
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
    <section className="ps-page sc-workshop" aria-label="Atelier de la structure">
      <div className="nv-glass nv-glass--thin sc-bar">
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm sc-bar__back" onClick={onClose}>
          ← Structures
        </button>
        <span className="sc-bar__chip" style={{ background: gradient(draft.color) }} aria-hidden="true" />
        <label className="sr-only" htmlFor={`${id}-name`}>
          Nom de la structure
        </label>
        <input
          id={`${id}-name`}
          className="sc-bar__name"
          value={draft.name}
          maxLength={SCRIPT_STRUCTURE_NAME_MAX}
          placeholder="Nom de la structure"
          aria-invalid={draft.name.trim() === '' ? true : undefined}
          onChange={(event) => {
            edit({ name: event.target.value });
          }}
        />
        <span className="sc-bar__state" data-state={state.tone} aria-live="polite">
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
        <div className="sc-notes">
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

      <div className="nv-plate sc-look">
        <div className="sc-look__moment">
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
        <fieldset className="sc-fieldset sc-look__color">
          <legend className="nv-field__label">
            Couleur du script
            <span className="sc-look__picked">{customColor ? 'Libre' : (presetName ?? 'Libre')}</span>
          </legend>
          <div className="sc-swatches" role="radiogroup" aria-label="Couleur du script">
            {SCRIPT_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                role="radio"
                className="sc-swatch"
                aria-checked={!customColor && presetOf(draft.color) === preset.key}
                title={preset.name}
                aria-label={preset.name}
                style={{ background: gradient(preset.color) }}
                onClick={() => {
                  setCustomColor(false);
                  edit({ color: preset.color });
                }}
              />
            ))}
            <button
              type="button"
              role="radio"
              className="sc-swatch sc-swatch--free"
              aria-checked={customColor}
              onClick={() => {
                setCustomColor(true);
              }}
            >
              Libre
            </button>
          </div>
          {customColor ? (
            <div className="sc-free">
              <span
                className="sc-free__bar"
                style={{ background: gradient(draft.color) }}
                aria-hidden="true"
              />
              <div className="sc-free__tones">
                {(['primary', 'secondary', 'accent'] as const).map((tone, at) => (
                  <label key={tone} className="sc-free__tone">
                    <input
                      type="color"
                      value={draft.color[tone]}
                      onChange={(event) => {
                        edit({ color: { ...draft.color, [tone]: event.target.value } });
                      }}
                    />
                    <span>
                      {['Début', 'Milieu', 'Fin'][at]}
                      <span className="sc-free__hex">{draft.color[tone]}</span>
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

      <div className="sc-columns">
        <div className="nv-plate ps-panel sc-stack" style={{ '--sc-accent': gradient(draft.color) }}>
          <p className="nv-eyebrow">Ordre de vente</p>
          <ol className="sc-rows">
            {draft.segments.map((segment, at) => {
              const wrong = issues.has(segment.key);
              return (
                <li
                  key={segment.key}
                  className="sc-rows__item nv-enter"
                  style={{ '--nv-i': Math.min(at, 12) }}
                >
                  <div
                    className="sc-row"
                    data-kind={segment.kind}
                    data-current={segment.key === current?.key}
                  >
                    <button
                      type="button"
                      className="sc-row__main"
                      aria-current={segment.key === current?.key ? 'true' : undefined}
                      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                      onClick={() => {
                        setSelected(segment.key);
                        setVariant(null);
                        // On a phone the card and the sheet sit under the whole stack: the tap leads there.
                        if (window.matchMedia(NARROW).matches) {
                          previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }}
                      onKeyDown={(event) => {
                        onRowKey(event, at);
                      }}
                    >
                      <span className="sc-row__badge" aria-hidden="true">
                        {(titles.get(segment.key) ?? '').replace(/^(Étape|Pont) /u, '').replace(' & ', '·')}
                      </span>
                      <span className="sc-row__text">
                        <span className="sc-row__code">{titles.get(segment.key)}</span>
                        <span className="sc-row__name">
                          {segment.kind === 'stage'
                            ? segment.name || 'Sans nom'
                            : segment.teaser || 'Sans teaser'}
                        </span>
                        <span className="sc-row__sub">
                          {wrong ? <span className="ps-dot" data-dot="warn" aria-label="À corriger" /> : null}
                          <span
                            className="sc-access"
                            data-access={segment.kind === 'stage' ? segment.access : 'free'}
                          >
                            {segment.kind === 'stage' && segment.access === 'paid' ? 'Payant' : 'Gratuit'}
                          </span>
                          {slotsSummary(segment.mediaSlots)}
                          {segment.kind === 'stage' && segment.variants.length > 0 ? (
                            <span className="sc-row__series">
                              {`séries ${segment.variants.map((v) => v.letter).join(' ')}`}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <span className="sc-row__tools">
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm sc-row__tool"
                        aria-label={`Monter ${titles.get(segment.key) ?? ''}`}
                        disabled={at === 0}
                        onClick={() => {
                          segments(move(draft.segments, at, -1), segment.key);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm sc-row__tool"
                        aria-label={`Descendre ${titles.get(segment.key) ?? ''}`}
                        disabled={at === draft.segments.length - 1}
                        onClick={() => {
                          segments(move(draft.segments, at, 1), segment.key);
                        }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm sc-row__tool"
                        aria-label={`Retirer ${titles.get(segment.key) ?? ''}`}
                        disabled={
                          segment.kind === 'stage' &&
                          draft.segments.filter((other) => other.kind === 'stage').length === 1
                        }
                        onClick={() => {
                          segments(remove(draft.segments, at));
                        }}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                  {canBridgeAfter(draft.segments, at) ? (
                    <button
                      type="button"
                      className="sc-bridge-add"
                      onClick={() => {
                        const next = addBridgeAfter(draft.segments, at);
                        segments(next, next[at + 1]?.key);
                      }}
                    >
                      + Pont entre ces deux étapes
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm sc-stack__add"
            onClick={() => {
              const next = addStage(draft.segments, null);
              segments(next, next.at(-1)?.key);
            }}
          >
            + Ajouter une étape
          </button>
        </div>

        <div className="nv-plate ps-panel sc-editor">
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
                <ul className="sc-issues">
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

        <aside className="sc-preview" aria-label="Aperçu du carton" ref={previewRef}>
          <div className="sc-preview__card">
            {card.src === null ? (
              <div className="sc-preview__empty ps-skeleton" />
            ) : (
              <img
                key={card.src}
                className="sc-preview__img"
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
          <div className="sc-preview__thumb">
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
