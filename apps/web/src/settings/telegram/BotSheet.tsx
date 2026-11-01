import type { TelegramBot, TelegramChat, TelegramTopic } from '@nirvana/contracts';
import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { ReauthRequired } from '../services/api';

import { Reauth } from './Reauth';
import { addBot, fetchOverview, listen, replaceToken, saveRoutes, sendTest } from './api';
import {
  initials,
  knownChatIds,
  looksLikeToken,
  newChats,
  setTopicsOfChat,
  suggestedUsername,
  topicsOfChat,
  TOPICS,
} from './model';

/** `add`: the four steps. `listen`: put a known bot in one more group (steps 3 and 4). `replace`: a new token. */
export type SheetMode =
  { kind: 'add' } | { kind: 'listen'; bot: TelegramBot } | { kind: 'replace'; bot: TelegramBot };

type Step = 1 | 2 | 3 | 4;

/** The steps as the sheet's progress names them, as Sauvegardes names its own. */
const STEP_TITLES: Record<Step, string> = { 1: 'Créer', 2: 'Jeton', 3: 'Groupe', 4: 'Messages' };

const SHEET_TOPICS: readonly TelegramTopic[] = [
  'urgent',
  'important',
  'info',
  'sale',
  'validation',
  'keyword',
];
/** What a new group gets unless the person changes it: the alerts that need a human. */
const DEFAULT_TOPICS: readonly TelegramTopic[] = ['urgent', 'important'];
const POLL_MS = 2000;
/** The server listens 20 s per call (`LISTEN_SECONDS`); asked again a little before it stops. */
const RELISTEN_MS = 18_000;
const TOKEN_HINT =
  'Ce n’est pas un jeton de bot. Il ressemble à 123456789:AAF… : des chiffres, deux-points, puis une longue suite de lettres.';
const OFFLINE = 'Le serveur ne répond pas. Réessaie dans un instant.';

export function BotSheet({
  mode,
  onChanged,
  onClose,
}: {
  mode: SheetMode;
  /** Something was saved: the page reloads its state. */
  onChanged: () => void;
  onClose: () => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>(mode.kind === 'add' ? 1 : mode.kind === 'listen' ? 3 : 2);
  const [bot, setBot] = useState<TelegramBot | null>(mode.kind === 'add' ? null : mode.bot);
  const [found, setFound] = useState<TelegramChat[]>([]);
  /** The groups the bot sat in before step 3: only a new one counts as found. */
  const [known] = useState<ReadonlySet<string>>(() =>
    mode.kind === 'add' ? new Set() : knownChatIds(mode.bot),
  );
  const lastStep: Step = mode.kind === 'replace' ? 2 : 4;
  const firstStep: Step = mode.kind === 'add' ? 1 : mode.kind === 'listen' ? 3 : 2;

  return (
    <Scrim onClose={onClose}>
      <div className="tg-sheet__top">
        {mode.kind === 'replace' ? (
          <span />
        ) : (
          <ol className="tg-steps" aria-label="Étapes">
            {([1, 2, 3, 4] as const)
              .filter((n) => n >= firstStep && n <= lastStep)
              .map((n) => (
                <li
                  key={n}
                  data-state={n === step ? 'now' : n < step ? 'done' : 'later'}
                  aria-current={n === step ? 'step' : undefined}
                >
                  <span className="tg-steps__num">{String(n - firstStep + 1)}</span>
                  {STEP_TITLES[n]}
                </li>
              ))}
          </ol>
        )}
        <button type="button" className="nv-close" aria-label="Fermer" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {step === 1 ? (
        <CreateStep
          onNext={() => {
            setStep(2);
          }}
        />
      ) : step === 2 ? (
        <TokenStep
          bot={mode.kind === 'replace' ? mode.bot : null}
          verified={mode.kind === 'add' ? bot : null}
          onBack={
            mode.kind === 'add'
              ? () => {
                  setStep(1);
                }
              : null
          }
          onVerified={(verified) => {
            setBot(verified);
            onChanged();
          }}
          onNext={() => {
            if (mode.kind === 'replace') onClose();
            else setStep(3);
          }}
        />
      ) : step === 3 && bot !== null ? (
        <ListenStep
          bot={bot}
          known={known}
          found={found}
          onFound={(chats) => {
            setFound(chats);
            onChanged();
          }}
          onNext={() => {
            setStep(4);
          }}
        />
      ) : bot !== null ? (
        <TopicsStep bot={bot} chats={found} onDone={onClose} onChanged={onChanged} />
      ) : null}
    </Scrim>
  );
}

function CreateStep({ onNext }: { onNext: () => void }): JSX.Element {
  const [name, setName] = useState('Nirvana Alertes');
  // The identifier follows the name the chip offers, the default one when the field is emptied.
  const shownName = name.trim() === '' ? 'Nirvana Alertes' : name.trim();
  const username = suggestedUsername(shownName);
  return (
    <>
      <h2 id="tg-sheet-title">Crée ton bot</h2>
      <p>Telegram ne laisse créer un bot que par @BotFather. Ça prend une minute.</p>
      <ol className="tg-ol">
        <li>
          <div>
            <span>Ouvre @BotFather et envoie :</span>
            <CopyChip value="/newbot" />
          </div>
        </li>
        <li>
          <div>
            <span>Donne-lui un nom, celui que verra le groupe :</span>
            <input
              className="nv-field__control nv-glass tg-name"
              value={name}
              maxLength={64}
              aria-label="Nom du bot"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <CopyChip value={shownName} />
          </div>
        </li>
        <li>
          <div>
            <span>Puis un identifiant, qui doit finir par « bot » :</span>
            <CopyChip value={username} />
            <span className="tg-hint">S’il est déjà pris, ajoute des chiffres avant « _bot ».</span>
          </div>
        </li>
        <li>
          <div>
            <span>
              @BotFather répond avec un jeton, une longue ligne qui commence par des chiffres. Copie-le.
            </span>
          </div>
        </li>
      </ol>
      <div className="tg-sheet__actions">
        <a className="nv-btn nv-btn--soft" href="https://t.me/BotFather" target="_blank" rel="noreferrer">
          Ouvrir @BotFather ↗
        </a>
        <span className="tg-grow" />
        <button type="button" className="nv-btn nv-btn--neon" onClick={onNext}>
          J’ai le jeton
        </button>
      </div>
    </>
  );
}

type Check =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'reauth'; token: string }
  | { kind: 'ok'; bot: TelegramBot };

function TokenStep({
  bot,
  verified,
  onBack,
  onVerified,
  onNext,
}: {
  /** Set when replacing the token of this bot. */
  bot: TelegramBot | null;
  /** A bot already verified in this sheet (back from step 3). */
  verified: TelegramBot | null;
  onBack: (() => void) | null;
  onVerified: (bot: TelegramBot) => void;
  onNext: () => void;
}): JSX.Element {
  const [check, setCheck] = useState<Check>(
    verified === null ? { kind: 'idle' } : { kind: 'ok', bot: verified },
  );
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (check.kind === 'idle' || check.kind === 'error') input.current?.focus();
  }, [check.kind]);

  async function submit(raw: string): Promise<void> {
    const token = raw.trim();
    if (token === '') {
      setCheck({ kind: 'idle' });
      return;
    }
    if (!looksLikeToken(token)) {
      setCheck({ kind: 'error', message: TOKEN_HINT });
      return;
    }
    setCheck({ kind: 'busy' });
    try {
      const result = bot === null ? await addBot(token) : await replaceToken(bot.id, token);
      if (!result.ok) {
        setCheck({ kind: 'error', message: result.refusal.message });
        return;
      }
      if (input.current !== null) input.current.value = '';
      setCheck({ kind: 'ok', bot: result.value });
      onVerified(result.value);
    } catch (error) {
      setCheck(
        error instanceof ReauthRequired ? { kind: 'reauth', token } : { kind: 'error', message: OFFLINE },
      );
    }
  }

  return (
    <>
      <h2 id="tg-sheet-title">{bot === null ? 'Colle le jeton' : `Nouveau jeton pour ${bot.displayName}`}</h2>
      <p>
        {bot === null
          ? 'Nirvana le vérifie auprès de Telegram, puis le garde chiffré. Personne ne pourra le relire, même toi.'
          : 'Demande-le à @BotFather avec /token. Les groupes et les réglages du bot restent tels quels.'}
      </p>
      {check.kind === 'reauth' ? (
        <Reauth
          onConfirmed={() => void submit(check.token)}
          onCancel={() => {
            setCheck({ kind: 'idle' });
          }}
        />
      ) : check.kind === 'ok' ? null : (
        <form
          className="tg-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(input.current?.value ?? '');
          }}
        >
          <input
            ref={input}
            className="nv-field__control nv-glass tg-mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="Jeton du bot"
            aria-invalid={check.kind === 'error'}
            aria-describedby="tg-verify"
            placeholder="123456789:AAF…"
            disabled={check.kind === 'busy'}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = event.clipboardData.getData('text');
              event.currentTarget.value = pasted;
              void submit(pasted);
            }}
          />
          <button type="submit" className="nv-btn nv-btn--soft nv-btn--sm" disabled={check.kind === 'busy'}>
            Vérifier
          </button>
        </form>
      )}
      <div id="tg-verify" className="tg-verify" data-state={check.kind} aria-live="polite">
        {check.kind === 'idle' || check.kind === 'reauth' ? (
          <span className="tg-hint">La vérification part dès que tu colles.</span>
        ) : check.kind === 'busy' ? (
          <>
            <span className="tg-spin" />
            <span>Vérification auprès de Telegram…</span>
          </>
        ) : check.kind === 'error' ? (
          <span>{check.message}</span>
        ) : (
          <>
            <span className="tg-ok">✓</span>
            <span>
              <b>{check.bot.displayName}</b> <span className="tg-hint tg-mono">@{check.bot.username}</span>
              <br />
              <span className="tg-hint">Jeton valide, chiffré et enregistré.</span>
            </span>
          </>
        )}
      </div>
      <div className="tg-sheet__actions">
        {onBack === null ? null : (
          <button type="button" className="nv-btn nv-btn--plain" onClick={onBack}>
            Retour
          </button>
        )}
        <span className="tg-grow" />
        <button type="button" className="nv-btn nv-btn--neon" disabled={check.kind !== 'ok'} onClick={onNext}>
          {bot === null ? 'Continuer' : 'Terminé'}
        </button>
      </div>
    </>
  );
}

function ListenStep({
  bot,
  known,
  found,
  onFound,
  onNext,
}: {
  bot: TelegramBot;
  known: ReadonlySet<string>;
  found: readonly TelegramChat[];
  onFound: (chats: TelegramChat[]) => void;
  onNext: () => void;
}): JSX.Element {
  const [isOffline, setIsOffline] = useState(false);
  const count = useRef(found.length);
  const report = useRef(onFound);
  report.current = onFound;

  const look = useCallback(async (): Promise<void> => {
    try {
      const overview = await fetchOverview();
      setIsOffline(false);
      const chats = newChats(
        overview.bots.find((b) => b.id === bot.id),
        known,
      );
      if (chats.length !== count.current) {
        count.current = chats.length;
        report.current(chats);
      }
    } catch {
      setIsOffline(true);
    }
  }, [bot.id, known]);

  useEffect(() => {
    const ask = (): void => {
      listen(bot.id).catch(() => {
        setIsOffline(true);
      });
    };
    ask();
    const relisten = window.setInterval(ask, RELISTEN_MS);
    const poll = window.setInterval(() => void look(), POLL_MS);
    return () => {
      window.clearInterval(relisten);
      window.clearInterval(poll);
    };
  }, [bot.id, look]);

  return (
    <>
      <h2 id="tg-sheet-title">Ajoute {bot.displayName} à ton groupe</h2>
      <p>Choisis le groupe dans Telegram. Nirvana le verra arriver tout seul, rien à recopier.</p>
      {found.length === 0 ? (
        <div className="tg-listen" aria-live="polite">
          <div className="tg-radar" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="9" cy="8" r="3.2" />
              <path d="M3.5 19c.9-3 3-4.6 5.5-4.6s4.6 1.6 5.5 4.6M16 5.2a3 3 0 0 1 0 5.6M18 14.6c1.3.7 2.1 2.2 2.5 4.4" />
            </svg>
          </div>
          <div className="tg-whisper">J’attends le groupe…</div>
          <span className="tg-hint">
            {isOffline
              ? 'Le serveur ne répond pas pour l’instant. La page réessaie toute seule.'
              : 'Garde cette fenêtre ouverte pendant que tu l’ajoutes.'}
          </span>
        </div>
      ) : (
        <div className="tg-found-list" aria-live="polite">
          {found.map((chat) => (
            <div className="tg-found" key={chat.id}>
              <span className="tg-av">{initials(chat.title)}</span>
              <div className="tg-min0">
                <b>{chat.title}</b>
                <br />
                <span className="tg-hint">
                  {chat.canPost
                    ? `${bot.displayName} peut y écrire`
                    : 'Le bot ne peut pas y écrire : donne-lui le droit d’envoyer des messages'}
                </span>
              </div>
            </div>
          ))}
          <span className="tg-hint">Un autre groupe ? Ajoute le bot là-bas aussi, il apparaîtra ici.</span>
        </div>
      )}
      <div className="tg-sheet__actions">
        <a
          className="nv-btn nv-btn--soft"
          href={`https://t.me/${encodeURIComponent(bot.username)}?startgroup=nirvana`}
          target="_blank"
          rel="noreferrer"
        >
          Ouvrir dans Telegram ↗
        </a>
        <span className="tg-grow" />
        <button type="button" className="nv-btn nv-btn--neon" disabled={found.length === 0} onClick={onNext}>
          Continuer
        </button>
      </div>
    </>
  );
}

type Save = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string };
type Test = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok' } | { kind: 'error'; message: string };

function TopicsStep({
  bot,
  chats,
  onDone,
  onChanged,
}: {
  bot: TelegramBot;
  chats: readonly TelegramChat[];
  onDone: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [current, setCurrent] = useState(0);
  const [topics, setTopics] = useState<Record<string, readonly TelegramTopic[]>>(() =>
    Object.fromEntries(chats.map((chat) => [chat.id, DEFAULT_TOPICS])),
  );
  const [save, setSave] = useState<Save>({ kind: 'idle' });
  const [test, setTest] = useState<Test>({ kind: 'idle' });
  const chat = chats[current];

  /** A group that already had routes (put back in after a removal) keeps them. */
  useEffect(() => {
    let live = true;
    fetchOverview().then(
      (overview) => {
        if (!live) return;
        setTopics((before) =>
          Object.fromEntries(
            chats.map((c) => {
              const saved = topicsOfChat(overview.routes, c.id);
              return [c.id, saved.length > 0 ? saved : (before[c.id] ?? DEFAULT_TOPICS)];
            }),
          ),
        );
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [chats]);

  if (chat === undefined) return <p>Aucun groupe trouvé.</p>;
  const chosen = topics[chat.id] ?? DEFAULT_TOPICS;

  async function finish(): Promise<void> {
    setSave({ kind: 'busy' });
    try {
      // Read just before writing: another tab may have changed the routing in the meantime.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const overview = await fetchOverview();
        const routes = chats.reduce(
          (all, c) => setTopicsOfChat(all, c.id, topics[c.id] ?? DEFAULT_TOPICS),
          overview.routes,
        );
        const result = await saveRoutes(overview.version, routes);
        if (result.ok) {
          onChanged();
          onDone();
          return;
        }
        if (result.refusal.kind !== 'routes_version_conflict') {
          setSave({ kind: 'error', message: result.refusal.message });
          return;
        }
      }
      setSave({ kind: 'error', message: 'Les réglages bougent en ce moment. Réessaie dans un instant.' });
    } catch {
      setSave({ kind: 'error', message: OFFLINE });
    }
  }

  return (
    <>
      <h2 id="tg-sheet-title">Que doit recevoir « {chat.title} » ?</h2>
      <p>Pour toutes les créatrices. Tu affineras ensuite dans chaque onglet.</p>
      {chats.length > 1 ? (
        <div className="tg-scope" role="radiogroup" aria-label="Groupe">
          {chats.map((c, index) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={index === current}
              onClick={() => {
                setCurrent(index);
                setTest({ kind: 'idle' });
              }}
            >
              {c.title}
            </button>
          ))}
        </div>
      ) : null}
      <div>
        {SHEET_TOPICS.map((topic) => (
          <label className="tg-sw" key={topic}>
            <span className="tg-lvl">
              <b>
                <span className="tg-dot" data-topic={topic} />
                {TOPICS[topic].label}
              </b>
              <small>{TOPICS[topic].sub}</small>
            </span>
            <input
              type="checkbox"
              className="nv-switch"
              checked={chosen.includes(topic)}
              onChange={(event) => {
                const on = event.target.checked;
                setTopics({
                  ...topics,
                  [chat.id]: on ? [...chosen, topic] : chosen.filter((t) => t !== topic),
                });
              }}
            />
          </label>
        ))}
      </div>
      {save.kind === 'error' ? (
        <p className="tg-hint" data-error="true" role="alert">
          {save.message}
        </p>
      ) : null}
      <div className="tg-sheet__actions">
        {test.kind === 'ok' ? (
          <span className="tg-sent">✓ Reçu dans « {chat.title} »</span>
        ) : (
          <button
            type="button"
            className="nv-btn nv-btn--soft"
            disabled={test.kind === 'busy' || !chat.canPost}
            onClick={() => {
              setTest({ kind: 'busy' });
              sendTest(chat.id).then(
                (result) => {
                  setTest(result.ok ? { kind: 'ok' } : { kind: 'error', message: result.refusal.message });
                  onChanged();
                },
                () => {
                  setTest({ kind: 'error', message: OFFLINE });
                },
              );
            }}
          >
            {test.kind === 'busy' ? 'Envoi…' : 'Envoyer un test'}
          </button>
        )}
        <span className="tg-grow" />
        <button
          type="button"
          className="nv-btn nv-btn--neon"
          disabled={save.kind === 'busy'}
          onClick={() => void finish()}
        >
          Terminer
        </button>
      </div>
      {test.kind === 'error' ? (
        <p className="tg-hint" data-error="true" role="alert">
          {test.message}
        </p>
      ) : null}
      <p className="tg-hint">
        Les messages viennent de {bot.displayName}. Rien du texte des fans n’y part jamais.
      </p>
    </>
  );
}

type Copy = 'idle' | 'copied' | 'selected';

/**
 * Copies the value. When the browser refuses the clipboard (plain http, permission), the value is selected instead
 * and the chip says so: it never claims a copy that did not happen.
 */
function CopyChip({ value }: { value: string }): JSX.Element {
  const [copy, setCopy] = useState<Copy>('idle');
  const text = useRef<HTMLElement>(null);
  useEffect(() => {
    if (copy === 'idle') return undefined;
    const timer = window.setTimeout(() => {
      setCopy('idle');
    }, 1400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copy]);
  const select = (): void => {
    const selection = window.getSelection();
    if (text.current === null || selection === null) return;
    const range = document.createRange();
    range.selectNodeContents(text.current);
    selection.removeAllRanges();
    selection.addRange(range);
    setCopy('selected');
  };
  return (
    <button
      type="button"
      className="tg-copy"
      data-copied={copy === 'copied'}
      onClick={() => {
        // `navigator.clipboard` only exists in a secure context (https, localhost).
        if (!window.isSecureContext) {
          select();
          return;
        }
        navigator.clipboard.writeText(value).then(() => {
          setCopy('copied');
        }, select);
      }}
    >
      <b ref={text}>{value}</b>
      <span>{copy === 'copied' ? 'Copié' : copy === 'selected' ? 'Sélectionné' : 'Copier'}</span>
    </button>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])';

/** A modal sheet: Tab stays inside, Escape closes, and focus goes back to what opened it. */
function Scrim({ children, onClose }: { children: ReactNode; onClose: () => void }): JSX.Element {
  const sheet = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    },
    [opener],
  );
  // The latest `onClose` without re-running the effect: focus moves once, when the sheet opens.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  // Portalled to <body>: an ancestor's transform or filter (the page's entrance) would otherwise trap the fixed scrim.
  return createPortal(
    <div
      className="tg-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className="tg-sheet nv-glass nv-glass--thick"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tg-sheet-title"
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || sheet.current === null) return;
          const items = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
          const first = items[0];
          const last = items[items.length - 1];
          if (first === undefined || last === undefined) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
