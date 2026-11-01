import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * « Annulable quelques secondes » (EQ-03), as a sale was in Imperium: a report or a validation waits here before it is
 * sent, and « Annuler » takes it back with nothing to undo at the server. What is held is sent when its time is up,
 * when another is held, when the app goes to the background or the page away (the request is `keepalive`). One hold
 * for the whole app (`HoldProvider`, in the shell): what the server answers is said wherever the reader went since.
 */

export const HOLD_MS = 5_000;

/** What a held write answers once sent: said in the island, which stays on a refusal until it is closed. */
export type HoldResult =
  | { readonly ok: true; readonly title: string; readonly text: string }
  | {
      readonly ok: false;
      readonly title: string;
      readonly text: string;
      /** What to do about it from the island: « Rouvrir » the form with what was typed, say. */
      readonly action?: HoldAction;
    };

export interface HoldAction {
  readonly label: string;
  readonly run: () => void;
}

type Phase =
  | {
      readonly kind: 'held';
      readonly key: number;
      readonly title: string;
      readonly text: string;
      readonly endsAt: number;
    }
  | { readonly kind: 'sending'; readonly key: number; readonly title: string; readonly text: string }
  | { readonly kind: 'done'; readonly key: number; readonly title: string; readonly text: string }
  | {
      readonly kind: 'failed';
      readonly key: number;
      readonly title: string;
      readonly text: string;
      readonly action: HoldAction | null;
    };

interface Held {
  readonly key: number;
  readonly run: () => Promise<HoldResult>;
  readonly onCancel: (() => void) | undefined;
  readonly timer: number;
}

type Refusal = Extract<Phase, { readonly kind: 'failed' }>;

export interface Hold {
  readonly phase: Phase | null;
  /** The refusals of writes sent while another was held: each its own island, until it is closed. */
  readonly refusals: readonly Refusal[];
  /** Holds `run` for `HOLD_MS`, said by `title` (« Envoi du rapport », then « dans 5 s ») and `text` (what it sends). */
  readonly hold: (
    what: { readonly title: string; readonly text: string; readonly onCancel?: () => void },
    run: () => Promise<HoldResult>,
  ) => void;
  readonly cancel: () => void;
  /** Closes what the server said for the write `key`. */
  readonly dismiss: (key: number) => void;
}

const DONE_SHOWN_MS = 3_200;

interface Shown {
  readonly phase: Phase | null;
  readonly refusals: readonly Refusal[];
}

export function useHold(): Hold {
  const [shown, setShown] = useState<Shown>({ phase: null, refusals: [] });
  const held = useRef<Held | null>(null);
  const keys = useRef(0);
  const live = useRef(true);
  const fade = useRef<number | null>(null);

  const settle = useCallback((key: number, result: HoldResult): void => {
    if (!live.current) return;
    const next: Phase = result.ok
      ? { kind: 'done', key, title: result.title, text: result.text }
      : { kind: 'failed', key, title: result.title, text: result.text, action: result.action ?? null };
    // Its own island when it still has it; otherwise a refusal gets one of its own, and a success says nothing more.
    setShown((now) =>
      now.phase?.key === key
        ? { ...now, phase: next }
        : next.kind === 'failed'
          ? { ...now, refusals: [...now.refusals, next] }
          : now,
    );
    if (result.ok) {
      if (fade.current !== null) window.clearTimeout(fade.current);
      fade.current = window.setTimeout(() => {
        setShown((now) =>
          now.phase?.key === key && now.phase.kind === 'done' ? { ...now, phase: null } : now,
        );
      }, DONE_SHOWN_MS);
    }
  }, []);

  /** Sends what is held now: its time is up, another comes, the app is hidden or the page goes away. */
  const flush = useCallback(
    (quiet: boolean): void => {
      const now = held.current;
      if (now === null) return;
      held.current = null;
      window.clearTimeout(now.timer);
      if (!quiet) {
        setShown((before) =>
          before.phase?.key === now.key ? { ...before, phase: { ...before.phase, kind: 'sending' } } : before,
        );
      }
      void now.run().then(
        (result) => {
          settle(now.key, result);
        },
        () => {
          settle(now.key, {
            ok: false,
            title: 'Rien n’a été envoyé',
            text: 'Le serveur ne répond pas. Réessaie dans un instant.',
          });
        },
      );
    },
    [settle],
  );

  const hold = useCallback<Hold['hold']>(
    (what, run) => {
      flush(true);
      if (fade.current !== null) window.clearTimeout(fade.current);
      keys.current += 1;
      const key = keys.current;
      const timer = window.setTimeout(() => {
        flush(false);
      }, HOLD_MS);
      held.current = { key, run, onCancel: what.onCancel, timer };
      setShown((now) => ({
        ...now,
        phase: { kind: 'held', key, title: what.title, text: what.text, endsAt: Date.now() + HOLD_MS },
      }));
    },
    [flush],
  );

  const cancel = useCallback((): void => {
    const now = held.current;
    if (now === null) return;
    held.current = null;
    window.clearTimeout(now.timer);
    setShown((before) => ({ ...before, phase: null }));
    now.onCancel?.();
  }, []);

  const dismiss = useCallback((key: number): void => {
    setShown((now) =>
      now.phase?.key === key && now.phase.kind !== 'held'
        ? { ...now, phase: null }
        : { ...now, refusals: now.refusals.filter((one) => one.key !== key) },
    );
  }, []);

  useEffect(() => {
    live.current = true;
    // The phone's app goes to the background without `pagehide` (back to Reveal), and its timers sleep: send now.
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') flush(false);
    };
    const leave = (): void => {
      flush(false);
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leave);
      live.current = false;
      if (fade.current !== null) window.clearTimeout(fade.current);
      flush(true);
    };
  }, [flush]);

  return { phase: shown.phase, refusals: shown.refusals, hold, cancel, dismiss };
}

const HoldContext = createContext<Hold | null>(null);

/** The app's one hold and its islands, above every screen (the shell mounts it once). */
export function HoldProvider({ children }: { children: ReactNode }): JSX.Element {
  const hold = useHold();
  return (
    <HoldContext.Provider value={hold}>
      {children}
      <HoldIsland hold={hold} />
    </HoldContext.Provider>
  );
}

/** The app's hold, from a screen. */
export function useAppHold(): Hold {
  const hold = useContext(HoldContext);
  if (hold === null) throw new Error('useAppHold needs the shell’s HoldProvider');
  return hold;
}

/** The seconds left, counted down while something is held. */
function useSecondsLeft(endsAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return undefined;
    setNow(Date.now());
    const tick = window.setInterval(() => {
      setNow(Date.now());
    }, 200);
    return () => {
      window.clearInterval(tick);
    };
  }, [endsAt]);
  // Before its effect runs, `now` is the last hold's: never more than a whole hold.
  return endsAt === null ? 0 : Math.min(HOLD_MS / 1000, Math.max(0, Math.ceil((endsAt - now) / 1000)));
}

/**
 * The islands at the foot of the screen: the countdown and « Annuler » while held, then what the server said, above
 * it the refusals of writes sent meanwhile. Above the phone's tab bar; announced politely, and at once on a refusal.
 */
export function HoldIsland({ hold }: { hold: Hold }): JSX.Element | null {
  const { phase, refusals } = hold;
  const left = useSecondsLeft(phase?.kind === 'held' ? phase.endsAt : null);
  if (phase === null && refusals.length === 0) return null;
  return createPortal(
    <div className="rp-islands">
      {refusals.map((refusal) => (
        <Island key={refusal.key} phase={refusal} left={0} hold={hold} />
      ))}
      {phase === null ? null : <Island key={phase.key} phase={phase} left={left} hold={hold} />}
    </div>,
    document.body,
  );
}

function Island({ phase, left, hold }: { phase: Phase; left: number; hold: Hold }): JSX.Element {
  const dismiss = (): void => {
    hold.dismiss(phase.key);
  };
  return (
    <div
      className="rp-island nv-glass nv-glass--float"
      data-phase={phase.kind}
      role={phase.kind === 'failed' ? 'alert' : 'status'}
      aria-live={phase.kind === 'failed' ? 'assertive' : 'polite'}
    >
      <span className="rp-island__mark" aria-hidden="true">
        {phase.kind === 'held' ? (
          <>
            <svg viewBox="0 0 36 36" className="rp-island__ring">
              <circle cx="18" cy="18" r="16" pathLength={1} className="rp-island__track" />
              <circle
                cx="18"
                cy="18"
                r="16"
                pathLength={1}
                className="rp-island__left"
                style={{ animationDuration: `${String(HOLD_MS)}ms` }}
              />
            </svg>
            <span className="rp-island__count nv-num">{left}</span>
          </>
        ) : phase.kind === 'sending' ? (
          <span className="rp-island__spin" />
        ) : phase.kind === 'done' ? (
          <svg viewBox="0 0 20 20" className="rp-island__glyph">
            <path d="m5 10.5 3.2 3.2L15 7" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="rp-island__glyph">
            <path d="M10 5.5v5.5M10 14.2v.1" />
          </svg>
        )}
      </span>
      <span className="rp-island__body">
        <span className="rp-island__title">
          {phase.kind === 'held' ? `${phase.title} dans ${String(left)} s` : phase.title}
        </span>
        <span className="rp-island__text">{phase.text}</span>
      </span>
      {phase.kind === 'held' ? (
        <button type="button" className="nv-btn nv-btn--soft nv-btn--sm rp-island__act" onClick={hold.cancel}>
          Annuler
        </button>
      ) : phase.kind === 'sending' ? null : (
        <span className="rp-island__acts">
          {phase.kind === 'failed' && phase.action !== null ? (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                dismiss();
                phase.action?.run();
              }}
            >
              {phase.action.label}
            </button>
          ) : null}
          <button type="button" className="nv-iconbtn rp-island__close" aria-label="Fermer" onClick={dismiss}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </span>
      )}
    </div>
  );
}
