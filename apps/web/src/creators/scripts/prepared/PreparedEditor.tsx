import type {
  BranchCondition,
  CreatorId,
  PreparedBranch,
  PreparedScriptContent,
  PreparedScriptView,
} from '@impera/contracts';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { StepCard } from './StepCard';
import { changePreparedState, savePrepared } from './api';
import { ConditionDialog, MediaPicker } from './dialogs';
import type { EditorMedia, PickerFolder } from './media';
import {
  PATHS_SHOWN,
  branchAt,
  branchPlace,
  emptyStep,
  gapText,
  priceLabel,
  scriptPaths,
  warningText,
  withBranch,
  withBranchAdded,
  withStep,
  withStepMoved,
  withoutBranch,
  withoutStep,
} from './model';
import { MomentChoice } from './parts';

/** How long the editor waits after the last keystroke before it saves. */
export const SAVE_AFTER_MS = 900;

type SaveState =
  | { readonly kind: 'saved' }
  | { readonly kind: 'dirty' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * One script in preparation (ADR 0112 §§ 20-24): its name, description and moment, its steps and their branches, the
 * gaps the server finds after each save, and on the side what a fan pays on each path. Saved by itself a moment after
 * each change, on the revision read; « Prêt à copier dans Reveal » once nothing is missing. A script Reveal's import
 * recognised is closed: it reads, it no longer changes.
 */
export function PreparedEditor({
  creatorId,
  creatorName,
  initial,
  media,
  folders,
  onSaved,
  onReload,
  onCopy,
  onBack,
}: {
  creatorId: CreatorId;
  creatorName: string;
  initial: PreparedScriptView;
  media: ReadonlyMap<string, EditorMedia>;
  folders: readonly PickerFolder[];
  /** Each answer of the server, for the list to show the same. */
  onSaved: (view: PreparedScriptView) => void;
  /** Saved by someone else since: the list is read again and the editor starts from it. */
  onReload: () => void;
  onCopy: () => void;
  onBack: () => void;
}): JSX.Element {
  const id = useId();
  const [view, setView] = useState(initial);
  const [content, setContent] = useState<PreparedScriptContent>(initial.content);
  const [save, setSave] = useState<SaveState>({ kind: 'saved' });
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set([0]));
  const [picking, setPicking] = useState<string | null>(null);
  const [conditioning, setConditioning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The branches whose price as typed is refused: the last good one is kept, never said « Enregistré » (PRO1-08).
  const [refusedPrices, setRefusedPrices] = useState<ReadonlySet<string>>(new Set());
  const sent = useRef(initial.content);
  const latest = useRef(initial.content);
  latest.current = content;
  const closed = view.state === 'matched';

  const change = (next: (before: PreparedScriptContent) => PreparedScriptContent): void => {
    if (closed) return;
    setContent(next);
    // While a save is under way, its answer says whether more is left to save: never two saves on one revision.
    setSave((was) => (was.kind === 'stale' || was.kind === 'saving' ? was : { kind: 'dirty' }));
  };

  // A moment after the last change, the content is saved on the revision read; a change made while it saves waits for
  // its answer, then goes on the new revision.
  useEffect(() => {
    if (save.kind !== 'dirty') return;
    const timer = window.setTimeout(() => {
      const sending = content;
      setSave({ kind: 'saving' });
      void savePrepared(creatorId, view.id, view.revision, sending).then((outcome) => {
        if (outcome.kind === 'ok') {
          sent.current = sending;
          setView(outcome.view);
          onSaved(outcome.view);
          setSave({ kind: latest.current === sending ? 'saved' : 'dirty' });
        } else if (outcome.kind === 'stale') setSave({ kind: 'stale', message: outcome.message });
        else setSave({ kind: 'failed', message: outcome.message });
      });
    }, SAVE_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [save.kind, content, creatorId, view.id, view.revision, onSaved]);

  const refused = content.steps
    .flatMap((step) => step.branches)
    .filter((branch) => refusedPrices.has(branch.key))
    .map(
      (branch) =>
        `${branchPlace(content, branch.key).replace(/^./u, (first) => first.toUpperCase())} : prix à corriger, l’ancien est gardé`,
    );
  const settled = save.kind === 'saved' && content === sent.current && refused.length === 0;
  const gaps = view.gaps;
  const missing = gaps.length + refused.length;
  const toState = async (to: 'ready' | 'editing'): Promise<void> => {
    setBusy(true);
    const outcome = await changePreparedState(creatorId, view.id, view.revision, to);
    setBusy(false);
    if (outcome.kind === 'ok') {
      setView(outcome.view);
      onSaved(outcome.view);
      if (to === 'ready') onCopy();
    } else if (outcome.kind === 'stale') setSave({ kind: 'stale', message: outcome.message });
    else setSave({ kind: 'failed', message: outcome.message });
  };

  const goToFirstGap = (): void => {
    const first = gaps.find((gap) => gap.step !== null);
    if (first?.step === null || first === undefined) return;
    const step = first.step;
    setOpen((before) => new Set([...before, step]));
    window.requestAnimationFrame(() => {
      document
        .getElementById(`${id}-step-${String(step)}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const picked = picking === null ? null : branchAt(content, picking);
  const conditioned = conditioning === null ? null : branchAt(content, conditioning);
  const paths = scriptPaths(content);
  const saveLine =
    save.kind === 'saving'
      ? 'Enregistrement…'
      : save.kind === 'dirty'
        ? 'Modifications en cours'
        : save.kind === 'saved'
          ? refused.length > 0
            ? 'Un prix n’est pas enregistré'
            : 'Enregistré'
          : save.message;

  return (
    <div className="se-page" data-view="editeur">
      <div className="se-edbar">
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={onBack}>
          ← Ses scripts
        </button>
        <p className="se-edbar__sub">
          <span className="se-pill se-pill--draft">
            {view.state === 'matched'
              ? 'Reconnu dans Reveal'
              : view.state === 'ready_to_copy'
                ? 'Prêt à copier'
                : 'Brouillon'}
          </span>
          {creatorName}
        </p>
      </div>
      {save.kind === 'stale' ? (
        <div className="se-missing" role="alert">
          <span className="se-missing__icon" aria-hidden="true">
            !
          </span>
          <div className="se-missing__text">
            <div className="se-missing__title">{save.message}</div>
          </div>
          <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onReload}>
            Recharger
          </button>
        </div>
      ) : null}
      <div className="se-editor">
        <div className="se-main">
          <section className="nv-plate nv-plate--pad se-headcard" aria-label="Le script">
            <div className="se-headcard__top">
              <p className="nv-eyebrow">Le script</p>
              <MomentChoice
                value={content.moment}
                onChange={(moment) => {
                  change((before) => ({ ...before, moment }));
                }}
              />
            </div>
            <input
              className="se-inline se-name"
              aria-label="Nom du script"
              placeholder="Son nom, comme il s’écrira dans Reveal"
              value={content.name}
              readOnly={closed}
              maxLength={200}
              onChange={(event) => {
                const name = event.target.value;
                change((before) => ({ ...before, name }));
              }}
            />
            <textarea
              className="se-inline se-desc"
              aria-label="Description du script"
              placeholder="Le thème, la situation, l’envie servie"
              rows={2}
              value={content.description}
              readOnly={closed}
              maxLength={2000}
              onChange={(event) => {
                const description = event.target.value;
                change((before) => ({ ...before, description }));
              }}
            />
            {closed ? (
              <div className="se-missing se-ready" role="status">
                <span className="se-missing__icon" aria-hidden="true">
                  ✓
                </span>
                <div className="se-missing__text">
                  <div className="se-missing__title">Reconnu dans Reveal</div>
                  <ul>
                    <li>Il se règle maintenant depuis le script importé.</li>
                  </ul>
                </div>
              </div>
            ) : missing > 0 ? (
              <div className="se-missing" role="status">
                <span className="se-missing__icon" aria-hidden="true">
                  !
                </span>
                <div className="se-missing__text">
                  <div className="se-missing__title">
                    {missing === 1 ? 'Il manque une chose' : `Il manque ${String(missing)} choses`}
                  </div>
                  <ul>
                    {refused.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                    {gaps.map((gap, at) => (
                      <li key={`${gap.code}-${String(at)}`}>{gapText(content, gap)}</li>
                    ))}
                  </ul>
                </div>
                {gaps.some((gap) => gap.step !== null) ? (
                  <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={goToFirstGap}>
                    Aller au premier manque
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="se-missing se-ready" role="status">
                <span className="se-missing__icon" aria-hidden="true">
                  ✓
                </span>
                <div className="se-missing__text">
                  <div className="se-missing__title">Rien ne manque</div>
                  <ul>
                    <li>Il peut passer dans « À copier dans Reveal ».</li>
                  </ul>
                </div>
              </div>
            )}
          </section>
          <div className="se-steps">
            {content.steps.map((step, index) => (
              <div key={step.key} id={`${id}-step-${String(index)}`}>
                <StepCard
                  creatorId={creatorId}
                  content={content}
                  step={step}
                  index={index}
                  open={open.has(index)}
                  gaps={gaps.filter((gap) => gap.step === index)}
                  media={media}
                  onToggle={() => {
                    setOpen((before) => {
                      const next = new Set(before);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    });
                  }}
                  actions={{
                    onBranch: (key, next: (branch: PreparedBranch) => PreparedBranch) => {
                      change((before) => withBranch(before, key, next));
                    },
                    onRhythm: (rhythm) => {
                      change((before) => withStep(before, index, (one) => ({ ...one, rhythm })));
                    },
                    onAddBranch: () => {
                      change((before) => withBranchAdded(before, index));
                    },
                    onRemoveBranch: (key) => {
                      change((before) => withoutBranch(before, key));
                    },
                    onPriceRefused: (key, now) => {
                      setRefusedPrices((before) => {
                        if (before.has(key) === now) return before;
                        const next = new Set(before);
                        if (now) next.add(key);
                        else next.delete(key);
                        return next;
                      });
                    },
                    onPickMedia: setPicking,
                    onCondition: setConditioning,
                    onMove: (by) => {
                      change((before) => withStepMoved(before, index, by));
                      setOpen(new Set([index + by]));
                    },
                    onRemove: () => {
                      change((before) => withoutStep(before, index));
                      setOpen(new Set());
                    },
                  }}
                />
              </div>
            ))}
          </div>
          {closed ? null : (
            <button
              type="button"
              className="nv-btn nv-btn--soft se-addbranch"
              onClick={() => {
                const at = content.steps.length;
                change((before) => ({ ...before, steps: [...before.steps, emptyStep()] }));
                setOpen(new Set([at]));
              }}
            >
              ＋ Ajouter une étape
            </button>
          )}
          {closed ? null : (
            <div className="se-actions">
              <span className="se-actions__state" role="status">
                {saveLine}
                {view.state === 'editing' && gaps.length > 0 ? (
                  <span className="se-actions__why">
                    {gaps.length === 1 ? 'Il manque 1 chose' : `Il manque ${String(gaps.length)} choses`}
                  </span>
                ) : null}
              </span>
              <span className="se-actions__btns">
                {view.state === 'ready_to_copy' ? (
                  <>
                    <button
                      type="button"
                      className="nv-btn nv-btn--soft nv-btn--sm"
                      disabled={busy || !settled}
                      onClick={() => void toState('editing')}
                    >
                      Revenir au brouillon
                    </button>
                    <button type="button" className="nv-btn nv-btn--neon nv-btn--sm" onClick={onCopy}>
                      Voir comment le recopier
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`nv-btn nv-btn--sm ${gaps.length > 0 ? 'nv-btn--soft' : 'nv-btn--neon'}`}
                    disabled={busy || !settled || gaps.length > 0}
                    onClick={() => void toState('ready')}
                  >
                    <span className="se-lg">Prêt à copier dans Reveal</span>
                    <span className="se-sh">Prêt à copier</span>
                  </button>
                )}
              </span>
            </div>
          )}
        </div>
        <aside className="se-rail" aria-label="Ce qu’un fan paie">
          <section className="nv-plate nv-plate--pad se-card">
            <div>
              <p className="nv-eyebrow">Ce qu’un fan paie</p>
              <h2 className="nv-h3">Chaque chemin du script</h2>
            </div>
            {view.warnings.length > 0 ? (
              <div className="se-warns">
                {view.warnings.map((warning, at) => (
                  <span key={`${warning.code}-${String(at)}`} className="se-warn">
                    {warningText(content, warning)}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="se-paths">
              {paths.shown.map((path, at) => (
                <div key={`${path.name}-${String(at)}`} className="se-path">
                  <div className="se-path__head">
                    <span className="se-path__name">{path.name}</span>
                    <span className="se-path__total nv-num">{priceLabel(path.totalMinor)}</span>
                  </div>
                  <div className="se-chips">
                    {path.prices.map((minor, step) => (
                      <span key={String(step)} className="se-chips__one">
                        {step > 0 ? (
                          <span className="se-chip-arrow" aria-hidden="true">
                            ›
                          </span>
                        ) : null}
                        <span className={`se-chip-price nv-num${minor === 0 ? ' is-free' : ''}`}>
                          {priceLabel(minor)}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {paths.count > PATHS_SHOWN ? (
                <p className="se-note nv-num">et {String(paths.count - PATHS_SHOWN)} autres chemins</p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
      {picked === null || picking === null ? null : (
        <MediaPicker
          creatorId={creatorId}
          place={branchPlace(content, picking).replace(/^./u, (first) => first.toUpperCase())}
          folders={folders}
          media={media}
          moment={content.moment}
          taken={picked.branch.media.map((one) => one.ref)}
          onClose={() => {
            setPicking(null);
          }}
          onAdd={(refs) => {
            const key = picking;
            change((before) =>
              withBranch(before, key, (branch) => ({
                ...branch,
                media: [...branch.media, ...refs.map((ref) => ({ ref }))],
              })),
            );
            setPicking(null);
          }}
        />
      )}
      {conditioned === null || conditioning === null ? null : (
        <ConditionDialog
          content={content}
          stepIndex={conditioned.step}
          condition={conditioned.branch.condition}
          onClose={() => {
            setConditioning(null);
          }}
          onSave={(condition: BranchCondition) => {
            const key = conditioning;
            change((before) => withBranch(before, key, (branch) => ({ ...branch, condition })));
            setConditioning(null);
          }}
        />
      )}
    </div>
  );
}
