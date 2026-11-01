import { placeSegmentThumb } from '@nirvana/design-system';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

import type { FloatingTip } from './parts';

import { MODES, missingRows, nextMode, type AgentMode, type AutomaticGate } from '@/agent/mode';
import { keepTabInside } from '@/shell/focus';

/**
 * How long the veil still catches clicks once the dialog has closed: the length of its fade. A double click on
 * « Arrêter l'agent » would otherwise land its second click on the « À traiter » line under it (recette 28/10, G2).
 */
const CLOSING_MS = 500;

/** Arrow keys of the radio group and the way they move. */
const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The single control of the agent (revue 08, maquette v6): Automatique, open only when the server says so
 * (ADR 0019) and otherwise saying what is missing; Copilote; Arrêt, confirmed in a dialog that says what stops
 * and what stays. A radio group: the arrow keys move between the options that can be picked.
 */
export function ModeControl({
  mode,
  automatic,
  creatorName,
  tip,
  readOnly = null,
  running = false,
  onChange,
}: {
  mode: AgentMode;
  automatic: AutomaticGate;
  creatorName: string;
  tip: FloatingTip;
  /**
   * Why the mode cannot change from here, when it cannot (the sample, a global switch): the control shows the mode
   * and the other options give this reason.
   */
  readOnly?: string | null;
  /**
   * Reveal is read and a voice answers: the agent acts, and the dot of Copilote breathes. Otherwise, or when nothing
   * says so, the dot only marks the chosen mode (recette 28/10, M7), as the bar's pill does (`pillOf`).
   */
  running?: boolean;
  onChange: (mode: AgentMode) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const stopping = useRef(false);
  const locked = !automatic.open;
  const index = MODES.indexOf(mode);

  /** Why an option cannot be picked, if it cannot: the lock of Automatique first, then a read-only control. */
  const blocked = (option: AgentMode): boolean =>
    (option === 'auto' && locked) || (readOnly !== null && option !== mode);
  const noteFor = (option: AgentMode): { note?: string } =>
    readOnly !== null && option !== mode ? { note: readOnly } : {};
  const pick = (next: AgentMode): void => {
    if (next === mode || blocked(next)) return;
    if (next === 'stop') {
      stopping.current = false;
      setConfirming(true);
    } else onChange(next);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    if (readOnly !== null) return;
    const next = nextMode(mode, step, automatic);
    ref.current?.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus();
    pick(next);
  };

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    placeSegmentThumb(
      element,
      index,
      MODES.length,
      placed.current ? (thumbRef.current ?? undefined) : undefined,
    );
    placed.current = true;
  }, [index]);

  return (
    <>
      <div
        className="nv-seg nv-glass nv-glass--thin db-mode"
        role="radiogroup"
        aria-label="Mode de l’agent"
        data-tone={mode === 'stop' ? 'danger' : undefined}
        ref={ref}
        onKeyDown={onKeyDown}
      >
        <span className="nv-seg__thumb nv-glass nv-glass--thin" ref={thumbRef} aria-hidden="true" />
        <button
          type="button"
          role="radio"
          className="nv-seg__opt"
          data-mode="auto"
          tabIndex={mode === 'auto' ? 0 : -1}
          aria-checked={mode === 'auto'}
          aria-disabled={blocked('auto')}
          {...tip.bind({
            title: locked ? 'Automatique : verrouillé' : 'Automatique',
            text: locked
              ? 'L’agent enverrait seul, sans validation. Il s’ouvre quand tout ceci est rempli :'
              : 'L’agent envoie seul, sans validation, dans les limites réglées.',
            ...(locked ? { rows: missingRows(automatic) } : {}),
            ...noteFor('auto'),
          })}
          onClick={() => {
            pick('auto');
          }}
        >
          {locked ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          ) : null}
          Automatique
        </button>
        <button
          type="button"
          role="radio"
          className="nv-seg__opt"
          data-mode="copilot"
          tabIndex={mode === 'copilot' ? 0 : -1}
          aria-checked={mode === 'copilot'}
          aria-disabled={blocked('copilot')}
          {...tip.bind({
            title: 'Copilote',
            text: 'L’agent écrit, un chatteur valide chaque message dans Reveal avant qu’il parte.',
            ...noteFor('copilot'),
          })}
          onClick={() => {
            pick('copilot');
          }}
        >
          <span
            className={`nv-dot db-mode__dot${mode === 'copilot' ? ` nv-tone--ok${running ? ' nv-dot--live' : ''}` : ' db-mode__dot--rest'}`}
            aria-hidden="true"
          />
          Copilote
        </button>
        <button
          type="button"
          role="radio"
          className="nv-seg__opt"
          data-mode="stop"
          tabIndex={mode === 'stop' ? 0 : -1}
          aria-checked={mode === 'stop'}
          aria-disabled={blocked('stop')}
          {...tip.bind({
            title: 'Arrêt',
            text: 'L’agent n’écrit plus rien. Les chatteurs reprennent comme avant.',
            ...noteFor('stop'),
          })}
          onClick={() => {
            pick('stop');
          }}
        >
          <span
            className={`nv-dot db-mode__dot${mode === 'stop' ? ' nv-tone--bad' : ' db-mode__dot--rest'}`}
            aria-hidden="true"
          />
          Arrêt
        </button>
      </div>
      <StopDialog
        open={confirming}
        creatorName={creatorName}
        focusOnClose={() =>
          // The mode may not be on screen yet when the dialog closes: aim at the option it is going to.
          ref.current?.querySelector<HTMLElement>(`[data-mode="${stopping.current ? 'stop' : mode}"]`) ?? null
        }
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          stopping.current = true;
          setConfirming(false);
          onChange('stop');
        }}
      />
    </>
  );
}

function StopDialog({
  open,
  creatorName,
  focusOnClose,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  creatorName: string;
  /** Where the focus goes once the dialog closes: the option checked from then on, as the radio group wants. */
  focusOnClose: () => HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(open);
  // The latest handlers, so a re-render of the page while the dialog is open does not re-run the opening effect.
  const cancel = useRef(onCancel);
  const target = useRef(focusOnClose);
  useEffect(() => {
    cancel.current = onCancel;
    target.current = focusOnClose;
  }, [onCancel, focusOnClose]);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel.current();
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
      // Cancelled or confirmed, the focus lands back on the control, on the option now checked.
      target.current()?.focus({ preventScroll: true });
    };
  }, [open]);

  // Just closed: the veil keeps catching clicks while it fades.
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return undefined;
    setClosing(true);
    const timer = setTimeout(() => {
      setClosing(false);
    }, CLOSING_MS);
    return () => {
      clearTimeout(timer);
      setClosing(false);
    };
  }, [open]);

  // On the body: a transformed ancestor (the entering header, the stage) would capture `position: fixed`.
  return createPortal(
    <>
      <div
        className={`db-scrim${open ? ' is-on' : closing ? ' is-closing' : ''}`}
        onClick={open ? onCancel : undefined}
        aria-hidden="true"
      />
      <div
        className={`db-dialog nv-glass nv-glass--thick${open ? ' is-on' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="db-stop-title"
        aria-hidden={!open}
        inert={!open}
        onKeyDown={keepTabInside}
      >
        <h3 id="db-stop-title">Arrêter l’agent ?</h3>
        <p>Plus aucun message ne part au nom de {creatorName}, ni proposé ni envoyé.</p>
        <ul>
          <li>Les conversations restent lues et notées.</li>
          <li>Les chatteurs reprennent dans Reveal comme avant.</li>
          <li>Tu relances d’un clic sur Copilote.</li>
        </ul>
        <div className="db-dialog__actions">
          <button type="button" className="nv-btn nv-btn--soft" ref={cancelRef} onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="nv-btn nv-btn--soft nv-btn--destructive" onClick={onConfirm}>
            Arrêter l’agent
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
