import type {
  Destination,
  PlaygroundBrief,
  PlaygroundComparison,
  PlaygroundMedia,
  Verdict,
} from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type JSX } from 'react';

import { Composer, Conversation, LessonCard, type LocalMode } from './playground/Conversation';
import { RateBar } from './playground/RateBar';
import { SetupPanel } from './playground/SetupPanel';
import { WhyPanel } from './playground/WhyPanel';
import { COMPARE_MODEL, PlaygroundError, type PlaygroundErrorCode } from './playground/client';
import {
  fanMessageCount,
  needsAttention,
  percent,
  personaLabel,
  personaShort,
  stepOf,
} from './playground/logic';
import { filedAck, isFiledWarning, isHandoff, isWaiting, suggestedDestination } from './playground/model';
import { revealTimes } from './playground/reveal';
import { usePlayground } from './playground/usePlayground';

import { initialOf } from '@/lib/utils';

/** The width under which the situation is a sheet over the conversation (playground.css). */
const PHONE = '(max-width: 820px)';

/** The fan's name while his notes give none: the fan type is already on the « Le fan » card. */
const FALLBACK_NAME = 'Fan fictif';

/** His first name from the notes (« Prénom : Théo »), or « Fan fictif ». */
function fanName(notes: readonly string[]): string {
  const given = notes
    .find((n) => /^prénom\s*:/i.test(n))
    ?.split(':')[1]
    ?.trim();
  return given === undefined || given === '' ? FALLBACK_NAME : given;
}

const ERRORS: Readonly<Record<PlaygroundErrorCode, string>> = {
  llm_unavailable: 'Grok ne répond pas : ajoute ou vérifie sa clé dans Réglages › Modèles IA.',
  unreachable: 'Le serveur ne répond pas. Réessaie dans un instant.',
  not_deployed: 'Le playground n’est pas encore en ligne sur ce serveur.',
  still_writing: 'L’agent rédige encore la réponse précédente.',
  forbidden: 'Le Playground est réservé au propriétaire pour l’instant.',
  failed: 'Le serveur n’a pas répondu. Réessaie dans un instant.',
};

/** How often the screen asks for the brain's reading while the voice writes. */
const READING_POLL_MS = 1500;

/** Under the first screen's title, only what to do: the title already says what went wrong (avis Design 16/11). */
const LOADING_ACTIONS: Readonly<Record<PlaygroundErrorCode, string>> = {
  llm_unavailable: 'Ajoute ou vérifie sa clé dans Réglages › Modèles IA.',
  unreachable: 'Réessaie dans un instant.',
  not_deployed: 'Il arrive avec la prochaine mise à jour du serveur.',
  still_writing: 'Attends la fin de la réponse précédente.',
  forbidden: ERRORS.forbidden,
  failed: 'Réessaie dans un instant.',
};

/** The first screen's title: the AI provider is named only when the server said it refused (V-ETA-06). */
const LOADING_TITLES: Readonly<Record<PlaygroundErrorCode, string>> = {
  llm_unavailable: 'Grok ne répond pas',
  unreachable: 'Le serveur ne répond pas',
  not_deployed: 'Le playground n’est pas en ligne',
  still_writing: 'L’agent rédige encore',
  forbidden: '',
  failed: 'Le serveur ne répond pas',
};

/**
 * Entraîner > Playground (spec moteur-ia/playground-entrainement.md): the same path as production with no
 * connection, one number on top, three gestures under each answer, every correction becomes a lesson.
 */
export function PlaygroundPage(): JSX.Element {
  const pg = usePlayground();
  const { state } = pg;
  const [mode, setMode] = useState<LocalMode>('idle');
  const [lesson, setLesson] = useState<{ verdict: Verdict; destination: Destination } | undefined>(undefined);
  const [comparison, setComparison] = useState<PlaygroundComparison | undefined>(undefined);
  const [writing, setWriting] = useState(false);
  /** When the last answer arrived, while its bubbles still appear one by one; null once all are shown. */
  const [revealFrom, setRevealFrom] = useState<number | null>(null);
  /** How many of its bubbles are shown while they appear; undefined: all of them. */
  const [shown, setShown] = useState<number | undefined>(undefined);
  /** While the voice writes: the brain's reading of his message, asked of the server as soon as it is done. */
  const [reading, setReading] = useState<PlaygroundBrief | undefined>(undefined);
  /** His message while she answers it, shown before the server sends the conversation back. */
  const [sent, setSent] = useState<string | undefined>(undefined);
  const [whyManual, setWhyManual] = useState<boolean | undefined>(undefined);
  /** Where the last lesson went, said until the next message. */
  const [filed, setFiled] = useState<Destination | undefined>(undefined);
  const [filedBlockedBy, setFiledBlockedBy] = useState<readonly string[]>([]);
  /** On a phone the situation is a sheet over the conversation. */
  const [sheetOpen, setSheetOpen] = useState(false);
  // The situation's sheet takes the focus when it opens and gives it back to « Fan » when it closes.
  const fanButton = useRef<HTMLButtonElement>(null);
  const sheetWasOpen = useRef(false);
  useEffect(() => {
    if (sheetOpen) document.querySelector<HTMLElement>('#pg-setup .nv-close')?.focus();
    else if (sheetWasOpen.current) fanButton.current?.focus();
    sheetWasOpen.current = sheetOpen;
  }, [sheetOpen]);
  // The sheet is a phone's: a screen that widens past it (a tablet turned) closes it, its column back in place.
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const phone = matchMedia(PHONE);
    const onChange = (): void => {
      if (!phone.matches) setSheetOpen(false);
    };
    phone.addEventListener('change', onChange);
    return () => {
      phone.removeEventListener('change', onChange);
    };
  }, []);

  const pending = state?.pending ?? null;
  const step = stepOf(state, mode, pg.busy);
  const whyOpen = whyManual ?? needsAttention(pending);

  // A new answer resets the panel to its default: folded unless something needs a look.
  useEffect(() => {
    setWhyManual(undefined);
  }, [pending]);

  // Two steps: the brain reads him in a few seconds, the voice takes longer; its reading shows as soon as it is done.
  const client = pg.client;
  useEffect(() => {
    if (!writing) {
      setReading(undefined);
      return;
    }
    let live = true;
    const ask = (): void => {
      client
        .state()
        .then((s) => {
          if (live && s.reading !== undefined) setReading(s.reading);
        })
        .catch(() => undefined);
    };
    const timer = setInterval(ask, READING_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [writing, client]);

  // Her bubbles one by one, each after her typing time, as a fan sees them (Charles, 16/11).
  const delays = pending?.delaysMs;
  useEffect(() => {
    if (revealFrom === null || delays === undefined || delays.length < 1) {
      setShown(undefined);
      return;
    }
    const times = revealTimes(delays);
    const elapsed = Date.now() - revealFrom;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setShown(times.filter((t) => t <= elapsed).length);
    times.forEach((t, i) => {
      if (t > elapsed)
        timers.push(
          setTimeout(() => {
            setShown(i + 1);
          }, t - elapsed),
        );
    });
    const last = times.at(-1) ?? 0;
    timers.push(
      setTimeout(
        () => {
          setRevealFrom(null);
        },
        Math.max(0, last - elapsed),
      ),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [revealFrom, delays]);
  const revealing = shown !== undefined && delays !== undefined && shown < delays.length ? shown : undefined;

  const reset = (): void => {
    setMode('idle');
    setLesson(undefined);
    setComparison(undefined);
  };

  const rate = async (verdict: Verdict, destination?: Destination): Promise<void> => {
    let blockedBy: readonly string[] = [];
    const isRated = await pg.run(async (c) => {
      const rated = await c.rate(verdict, destination);
      blockedBy = (rated.exampleBlockedBy ?? []).map((v) => v.label);
      return rated;
    });
    if (!isRated) return;
    reset();
    setFiled(destination);
    setFiledBlockedBy(blockedBy);
    // A rejected answer gets a new draw for the same moment, as a trainer would ask « again ».
    if (verdict.kind === 'rejected' && state !== undefined && !isHandoff(state.pending)) {
      replay(fanMessageCount(state));
    }
  };

  const startLesson = (verdict: Verdict): void => {
    setLesson({ verdict, destination: suggestedDestination(verdict) ?? 'test' });
    setMode('lesson');
  };

  const answerTo = async (call: () => Promise<boolean>): Promise<boolean> => {
    setWriting(true);
    setRevealFrom(null);
    reset();
    const done = await call();
    setWriting(false);
    setSent(undefined);
    if (done) setRevealFrom(Date.now());
    return done;
  };

  const send = (text: string, media: PlaygroundMedia[]): Promise<boolean> => {
    setFiled(undefined);
    setSent(text);
    return answerTo(() => pg.run((c) => c.send(text, media)));
  };
  const replay = (n: number): void => {
    void answerTo(() => pg.run((c) => c.branch(n)));
  };

  const compare = async (): Promise<void> => {
    setWriting(true);
    try {
      setComparison(await pg.client.compare(COMPARE_MODEL));
      setMode('compare');
    } catch (error) {
      pg.fail(error instanceof PlaygroundError ? error.code : 'failed');
    } finally {
      setWriting(false);
    }
  };

  // Same keys as the copilot: A validate, E correct, R reject (docs/design/README.md).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && sheetOpen) {
        setSheetOpen(false);
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      // While her bubbles still appear, there is nothing to rate yet.
      if (revealing !== undefined) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.key === 'Escape' && mode !== 'idle') reset();
      else if (step === 'rate' && key === 'a') void rate({ kind: 'validated' });
      else if ((step === 'rate' || step === 'blocked') && key === 'e') {
        event.preventDefault();
        setMode('edit');
      } else if (step === 'rate' && key === 'r') setMode('reject');
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  });

  if (state === undefined) {
    const refused = pg.error === 'forbidden';
    return (
      <div className="pg-loading nv-plate" aria-busy={pg.isLoading}>
        {pg.isLoading ? null : (
          <div className="pg-loading__in nv-enter">
            {refused ? null : (
              <p
                className={`pg-loading__t ${pg.error === 'unreachable' || pg.error === 'llm_unavailable' ? 'is-warn' : ''}`}
              >
                {LOADING_TITLES[pg.error ?? 'failed']}
              </p>
            )}
            <p>{LOADING_ACTIONS[pg.error ?? 'failed']}</p>
            {/* Refused, a retry or the demo would only hide the reason: nothing to try. */}
            {refused ? null : (
              <>
                {/* The provider refuses: a retry alone settles nothing, the key is where it is fixed. */}
                {pg.error === 'llm_unavailable' ? (
                  <Link className="nv-btn nv-btn--soft" to="/reglages/modeles-ia">
                    Ouvrir Modèles IA
                  </Link>
                ) : null}
                <button type="button" className="nv-btn nv-btn--soft" onClick={pg.retry}>
                  Réessayer
                </button>
                <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={pg.switchToDemo}>
                  Essayer avec des réponses écrites à l’avance
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const name = fanName(state.fanNotes);
  const fans = fanMessageCount(state);
  // The rate with how many answers it stands on: 100 % on two answers is not 100 % on a hundred.
  const ratePill = pg.client.isDemo
    ? 'Démo'
    : state.rate.rate === null
      ? percent(null)
      : `${percent(state.rate.rate)} sur ${String(state.rate.rated)}`;

  return (
    <div className="pg">
      <RateBar state={state} isDemo={pg.client.isDemo} />
      <SetupPanel
        state={state}
        pg={pg}
        sheetOpen={sheetOpen}
        onCloseSheet={() => {
          setSheetOpen(false);
        }}
      />
      {/* A section, not a <main>: the shell already holds the page's one landmark (recette R-C5). */}
      <section className="pg-main nv-plate" aria-label="Conversation">
        <div className="pg-top">
          <span className="nv-avatar nv-avatar--sm">{initialOf(name)}</span>
          <span className="pg-top__t">
            <b>{name}</b>
            {/* Phone only: the bar that names the persona is hidden there (M13). */}
            <span className="pg-top__persona" title={personaLabel(state)}>
              {personaShort(state)}
            </span>
          </span>
          {/* Phone only: the rate in short, and the situation as a sheet (the column no longer hides them). */}
          <span
            className="pg-top__rate"
            title={pg.client.isDemo ? 'Démo : rien n’est noté pour de vrai' : 'Validées sans retouche'}
          >
            {ratePill}
          </span>
          <button
            type="button"
            ref={fanButton}
            className="nv-btn nv-btn--soft nv-btn--sm pg-top__fan"
            aria-expanded={sheetOpen}
            aria-controls="pg-setup"
            onClick={() => {
              setSheetOpen(!sheetOpen);
            }}
          >
            Fan
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--sm pg-top__btn"
            title="La même réponse par un autre modèle, côte à côte"
            aria-label="Comparer"
            disabled={step !== 'rate'}
            onClick={() => void compare()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="7" height="16" rx="2" />
              <rect x="14" y="4" width="7" height="16" rx="2" />
            </svg>
            <span>Comparer</span>
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--sm pg-top__btn"
            title="Même fan, conversation remise à zéro"
            aria-label="Recommencer"
            disabled={pg.busy}
            onClick={() => {
              reset();
              setFiled(undefined);
              void pg.run((c) => c.reset());
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
            <span>Recommencer</span>
          </button>
        </div>
        <Conversation
          state={state}
          mode={mode}
          busy={pg.busy}
          writing={writing}
          revealing={revealing}
          reading={reading}
          sent={sent}
          error={pg.error === undefined ? undefined : ERRORS[pg.error]}
          errorTone={pg.error === 'llm_unavailable' || pg.error === 'unreachable' ? 'warn' : 'bad'}
          lesson={lesson?.verdict}
          comparison={comparison}
          onValidate={() => void rate({ kind: 'validated' })}
          onEdit={() => {
            setMode('edit');
          }}
          onKeep={(text) => {
            startLesson({ kind: 'corrected', text });
          }}
          onReject={() => {
            setMode('reject');
          }}
          onReason={(reason) => {
            startLesson({ kind: 'rejected', reason });
          }}
          onCancel={reset}
          onRegenerate={() => {
            replay(fans);
          }}
          onHandoff={(wasRight) => {
            if (wasRight) void rate({ kind: 'validated' });
            else startLesson({ kind: 'rejected', reason: 'other', note: 'relais humain inutile' });
          }}
          onPick={(side) => {
            if (side === 'a') void rate({ kind: 'validated' });
            else startLesson({ kind: 'corrected', text: comparison?.bubbles.join('\n') ?? '' });
          }}
          onReplay={replay}
          // Marks are kept per creator: the invented persona has none to keep them for (ADR 0103 § 6).
          onMarkDesire={
            state.persona.played === null && !pg.client.isDemo
              ? undefined
              : (n, verdict) => {
                  void pg.run((c) => c.markDesire(n, verdict));
                }
          }
          onSend={send}
        />
        <div className="pg-dock">
          {filed === undefined || mode === 'lesson' ? null : (
            <p
              className={`pg-ack${isFiledWarning(filed, filedBlockedBy) ? ' pg-ack--warn' : ''}`}
              role="status"
            >
              {filedAck(filed, pg.client.isDemo, filedBlockedBy)}
            </p>
          )}
          {mode === 'lesson' && lesson !== undefined ? (
            <LessonCard
              destination={lesson.destination}
              busy={pg.busy}
              onDestination={(destination) => {
                setLesson({ ...lesson, destination });
              }}
              onConfirm={() => void rate(lesson.verdict, lesson.destination)}
              onCancel={reset}
            />
          ) : null}
          <Composer
            disabled={pg.busy || pending !== null || !state.voice.reachable}
            placeholder={
              !state.voice.reachable
                ? 'Ajoute d’abord une clé'
                : writing || revealing !== undefined
                  ? // Nothing to rate yet: « Note d’abord la réponse » waits for her last bubble (avis Design 16/11).
                    'Elle écrit…'
                  : pending === null
                    ? `Écris comme ${name === FALLBACK_NAME ? 'le fan' : name}…`
                    : isWaiting(pending)
                      ? 'Note d’abord son réflexe'
                      : 'Note d’abord la réponse'
            }
            onSend={send}
          />
        </div>
      </section>
      <WhyPanel
        state={state}
        reading={writing ? reading : undefined}
        open={whyOpen}
        onToggle={() => {
          setWhyManual(!whyOpen);
        }}
      />
    </div>
  );
}
