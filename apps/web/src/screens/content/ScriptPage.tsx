import {
  ContentDropFileIdSchema,
  kindOfMime,
  slotDurationRefusal,
  slotFileRefusal,
  slotLengths,
  type ContentDrop,
  type ContentDropFile,
  type ContentDropFileId,
  type ContentDropId,
  type ScriptSlot,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { Thumb } from './Thumb';
import { CONTENT_KEY, Refused, cardUrl, fillSlot, scriptDropKey, submitScript, useScriptDrop } from './api';
import { UNKNOWN_TYPE, fileLine, mimeOf, type LiveSend } from './model';
import {
  acceptOfSlot,
  cardDone,
  cardMeta,
  chooseWord,
  fileOfSlot,
  progressOf,
  scriptCards,
  slotLine,
  type ScriptCard,
} from './script-model';
import { isSending, queueSend, useLiveSends } from './sends';

import { ServerSilent } from '@/shell/ServerSilent';
import { Page, PageHeader } from '@/shell/layout';

import './content.css';
import './script.css';

/** How long her phone may take to read a video's length before the server reads it instead (ADR 0070 § 2). */
const PROBE_MS = 8_000;

/** A video's or a vocal's length, in milliseconds, read on her phone; `null` when it cannot say (the server will). */
function durationOf(file: File, kind: 'video' | 'audio'): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind);
    const done = (value: number | null): void => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => {
      done(null);
    }, PROBE_MS);
    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      done(Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : null);
    };
    media.onerror = () => {
      done(null);
    };
    media.src = url;
  });
}

/**
 * Her script, card by card (SC-02 lot b2, ADR 0056 § 4): one screen per card, its slots under it, then the preview of
 * the whole and « Envoyer le script ». Each file goes up as soon as she chooses it; she can leave and come back, the
 * server keeps what is filled.
 */
export function ScriptPage({ dropId, onBack }: { dropId: ContentDropId; onBack: () => void }): JSX.Element {
  const script = useScriptDrop(dropId);
  const client = useQueryClient();
  const sends = useLiveSends();
  /** The files chosen on this phone since the page opened, for their thumbnails. */
  const [chosen, setChosen] = useState<ReadonlyMap<ContentDropFileId, File>>(new Map());
  const [step, setStep] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (isSending()) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, []);

  const segments = script.data?.segments;
  const cards = useMemo(() => (segments === undefined ? [] : scriptCards(segments)), [segments]);
  const drop = script.data?.drop;
  const files = drop?.files ?? [];

  // She comes back where she left: the first card not done, or the preview when every one is.
  useEffect(() => {
    if (step !== null || drop === undefined || segments === undefined) return;
    const first = cards.findIndex((card) => !cardDone(card, drop.files));
    setStep(first === -1 ? cards.length : first);
  }, [step, drop, cards, segments]);

  const reread = (): void => {
    void client.invalidateQueries({ queryKey: scriptDropKey(dropId) });
    void client.invalidateQueries({ queryKey: CONTENT_KEY });
  };
  const show = (next: ContentDrop): void => {
    client.setQueryData(scriptDropKey(dropId), (old: typeof script.data) =>
      old === undefined ? old : { ...old, drop: next },
    );
  };
  const go = (next: number): void => {
    setStep(next);
    setFailed(null);
    top.current?.scrollIntoView({ block: 'start' });
  };

  if (script.isError) {
    return (
      <Page className="ct-page sk-page">
        <BackBar onBack={onBack} />
        {script.error instanceof Refused && script.error.status === 404 ? (
          <p className="sk-gone">Ce script n’est plus là : il a peut-être été retiré.</p>
        ) : (
          <ServerSilent
            text="Ton script n’a pas pu être lu. Rien n’est perdu : ce que tu as envoyé est gardé."
            onRetry={() => {
              void script.refetch();
            }}
          />
        )}
      </Page>
    );
  }
  if (script.data === undefined || drop === undefined || step === null) {
    return (
      <Page className="ct-page sk-page">
        <BackBar onBack={onBack} />
        <div className="ct-skeleton" aria-hidden="true">
          <i />
          <i />
        </div>
      </Page>
    );
  }

  const progress = progressOf(cards, files);
  const filling = drop.state === 'filling';
  const card = cards[step];
  const firstMissing = cards.findIndex((one) => !cardDone(one, files));
  const percent = progress.required === 0 ? 100 : Math.round((100 * progress.filled) / progress.required);

  return (
    <Page className="ct-page sk-page">
      <div ref={top} className="sk-top">
        <BackBar onBack={onBack} />
        <PageHeader eyebrow="📜 Script" title={script.data.name} />
        <div className="sk-progress">
          <div className="sk-progress__row">
            <span className="sk-progress__step nv-num">
              {card === undefined ? 'Aperçu' : `Carton ${String(step + 1)} sur ${String(cards.length)}`}
            </span>
            <span className="sk-progress__count nv-num">
              {progress.filled} / {progress.required} médias
            </span>
          </div>
          <div
            className="nv-gauge"
            role="progressbar"
            aria-label="Médias de ton script"
            aria-valuemin={0}
            aria-valuemax={progress.required}
            aria-valuenow={progress.filled}
          >
            <span className="nv-gauge__fill" style={{ '--nv-gauge-value': `${String(percent)}%` }} />
          </div>
        </div>
      </div>

      <div className="sk-body">
        {!filling ? (
          <p className="sk-gone">Ce script est déjà envoyé : tu le suis dans Contenu, « En route ».</p>
        ) : card === undefined ? (
          <Preview
            dropId={dropId}
            cards={cards}
            files={files}
            missing={progress.required - progress.filled}
            onOpen={go}
          />
        ) : (
          <CardStep
            key={`${card.segmentKey}:${card.variant ?? ''}`}
            dropId={dropId}
            card={card}
            files={files}
            sends={sends}
            chosen={chosen}
            onFilled={(picked, declared, next) => {
              setChosen((old) => new Map(old).set(declared.id, picked));
              show(next);
              void queueSend(dropId, declared.id, picked, reread);
            }}
            onResumed={(fileId, file) => {
              setChosen((old) => new Map(old).set(fileId, file));
              void queueSend(dropId, fileId, file, reread);
            }}
          />
        )}

        {filling ? (
          <div className="sk-foot">
            {failed === null ? null : (
              <p className="sk-foot__alert" role="alert">
                {failed}
              </p>
            )}
            <div className="sk-foot__row">
              {/* No « Précédent » on the first card: hidden, never a faded button (relecture Extension). */}
              {step === 0 ? null : (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain"
                  onClick={() => {
                    go(step - 1);
                  }}
                >
                  Précédent
                </button>
              )}
              {card !== undefined ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--neon"
                  onClick={() => {
                    go(step + 1);
                  }}
                >
                  {step === cards.length - 1 ? 'Voir l’aperçu' : 'Suivant'}
                </button>
              ) : firstMissing !== -1 ? (
                // A slot is missing: the way to it, never a disabled « Envoyer le script ».
                <button
                  type="button"
                  className="nv-btn nv-btn--neon"
                  onClick={() => {
                    go(firstMissing);
                  }}
                >
                  Compléter {cards[firstMissing]?.code}
                </button>
              ) : (
                <button
                  type="button"
                  className="nv-btn nv-btn--neon"
                  disabled={sending}
                  onClick={() => {
                    setSending(true);
                    setFailed(null);
                    submitScript(dropId)
                      .then(() => {
                        reread();
                        onBack();
                      })
                      .catch((error: unknown) => {
                        setFailed(
                          error instanceof Refused && error.status === 422
                            ? 'Il manque encore des médias : l’aperçu te dit lesquels.'
                            : 'L’envoi n’est pas passé : réessaie dans un instant.',
                        );
                        reread();
                      })
                      .finally(() => {
                        setSending(false);
                      });
                  }}
                >
                  Envoyer le script
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Page>
  );
}

function BackBar({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <button type="button" className="nv-btn nv-btn--plain nv-btn--sm sk-back" onClick={onBack}>
      <span aria-hidden="true">←</span> Contenu
    </button>
  );
}

/** One card: its image, as the agency drew it from her frozen version, and its slots. */
function CardStep({
  dropId,
  card,
  files,
  sends,
  chosen,
  onFilled,
  onResumed,
}: {
  dropId: ContentDropId;
  card: ScriptCard;
  files: readonly ContentDropFile[];
  sends: ReadonlyMap<string, LiveSend>;
  chosen: ReadonlyMap<ContentDropFileId, File>;
  onFilled: (file: File, declared: { id: ContentDropFileId }, next: ContentDrop) => void;
  onResumed: (fileId: ContentDropFileId, file: File) => void;
}): JSX.Element {
  return (
    <section className="sk-card nv-enter" aria-labelledby="sk-card-title">
      <div className="sk-card__titles">
        <span className="sk-code nv-num">{card.code}</span>
        <h2 id="sk-card-title" className="sk-card__title">
          {card.title}
        </h2>
      </div>
      {card.detail === null ? null : <p className="sk-card__detail">{card.detail}</p>}
      <img
        className="sk-card__image"
        src={cardUrl(dropId, card.segmentKey, card.variant)}
        width={1080}
        height={1080}
        alt={`Carton ${card.code} : ${card.title}`}
      />
      <ul className="sk-slots">
        {card.slots.map((slot, index) => (
          <SlotTile
            key={slot.key}
            dropId={dropId}
            slot={slot}
            rank={index + 1}
            file={fileOfSlot(files, slot.key)}
            sends={sends}
            chosen={chosen}
            onFilled={onFilled}
            onResumed={onResumed}
          />
        ))}
      </ul>
    </section>
  );
}

/** A slot: what it waits for, then her file, its progress, « Remplacer » (or « Reprendre » when its send was cut). */
function SlotTile({
  dropId,
  slot,
  rank,
  file,
  sends,
  chosen,
  onFilled,
  onResumed,
}: {
  dropId: ContentDropId;
  slot: ScriptSlot;
  rank: number;
  file: ContentDropFile | undefined;
  sends: ReadonlyMap<string, LiveSend>;
  chosen: ReadonlyMap<ContentDropFileId, File>;
  onFilled: (file: File, declared: { id: ContentDropFileId }, next: ContentDrop) => void;
  onResumed: (fileId: ContentDropFileId, file: File) => void;
}): JSX.Element {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const live = file === undefined ? undefined : sends.get(file.id);
  const local = file === undefined ? undefined : chosen.get(file.id);
  const interrupted = file?.state === 'awaiting' && (live === undefined || live.phase === 'failed');
  const percent =
    live === undefined || live.total === 0 ? 0 : Math.min(100, Math.floor((100 * live.sent) / live.total));
  const showsBar =
    file?.state === 'awaiting' &&
    live !== undefined &&
    (live.phase === 'sending' || live.phase === 'waiting');
  const warn = file?.state === 'refused' || interrupted;

  const choose = async (picked: File): Promise<void> => {
    setRefusal(null);
    // The same file again after a cut send: it goes on where it stopped (the server checks its bytes anyway).
    if (file !== undefined && interrupted && picked.size === file.bytes) {
      onResumed(file.id, picked);
      return;
    }
    const mime = mimeOf(picked);
    if (mime === null) {
      setRefusal(UNKNOWN_TYPE);
      return;
    }
    const declared = { id: ContentDropFileIdSchema.parse(crypto.randomUUID()), mime, bytes: picked.size };
    const sentence = slotFileRefusal(slot.slot, declared);
    if (sentence !== null) {
      setRefusal(sentence);
      return;
    }
    // Busy from here: reading a video's length can take seconds, a second choice must wait for it.
    setBusy(true);
    const kind = kindOfMime(mime);
    if (kind === 'video' || kind === 'audio') {
      const length = slotDurationRefusal(slotLengths(slot.slot), await durationOf(picked, kind));
      if (length !== null) {
        setRefusal(length);
        setBusy(false);
        return;
      }
    }
    try {
      onFilled(picked, declared, await fillSlot(dropId, slot.key, declared));
    } catch (error) {
      setRefusal(
        error instanceof Refused && error.sentences.length > 0
          ? error.message
          : 'Ce média n’a pas pu être ajouté : réessaie dans un instant.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="nv-plate sk-slot">
      <div className="sk-slot__head">
        <span className="sk-slot__rank nv-num" aria-hidden="true">
          {rank}
        </span>
        <span className="sk-slot__titles">
          <span className="sk-slot__kind">{slotLine(slot.slot)}</span>
          {slot.slot.hint === null ? null : <span className="sk-slot__hint">{slot.slot.hint}</span>}
        </span>
      </div>
      {file === undefined ? null : (
        <div className="sk-slot__file">
          {local === undefined ? (
            <span className="ct-thumb sk-slot__done" aria-hidden="true">
              {file.state === 'refused' ? '!' : '✓'}
            </span>
          ) : (
            <Thumb file={local} kind={file.kind} />
          )}
          <span className={warn ? 'sk-slot__line sk-slot__line--warn' : 'sk-slot__line nv-num'}>
            {fileLine(file, live)}
          </span>
        </div>
      )}
      {showsBar ? (
        <div
          className={live.phase === 'waiting' ? 'nv-gauge nv-gauge--amber' : 'nv-gauge'}
          role="progressbar"
          aria-label={`Envoi du média ${String(rank)}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="nv-gauge__fill" style={{ '--nv-gauge-value': `${String(percent)}%` }} />
        </div>
      ) : null}
      {refusal === null ? null : (
        <p className="sk-slot__refusal" role="alert">
          {refusal}
        </p>
      )}
      <div className="sk-slot__actions">
        <button
          type="button"
          className={
            file === undefined ? 'nv-btn nv-btn--soft nv-btn--sm' : 'nv-btn nv-btn--plain nv-btn--sm'
          }
          disabled={busy}
          onClick={() => {
            picker.current?.click();
          }}
        >
          {file === undefined ? chooseWord(slot.slot) : interrupted ? 'Reprendre' : 'Remplacer'}
        </button>
        <input
          ref={picker}
          type="file"
          hidden
          accept={acceptOfSlot(slot.slot)}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = '';
            if (picked !== undefined) void choose(picked);
          }}
        />
      </div>
    </li>
  );
}

/** The whole script before she sends it: each card, done or what it still waits for; a tap opens it. */
function Preview({
  dropId,
  cards,
  files,
  missing,
  onOpen,
}: {
  dropId: ContentDropId;
  cards: readonly ScriptCard[];
  files: readonly ContentDropFile[];
  missing: number;
  onOpen: (step: number) => void;
}): JSX.Element {
  return (
    <section className="sk-preview nv-enter" aria-labelledby="sk-preview-title">
      <h2 id="sk-preview-title" className="sk-preview__title">
        Aperçu de ton script
      </h2>
      <p className="sk-preview__lead">
        {missing === 0
          ? 'Tout est là. Relis tes cartons, puis envoie ton script.'
          : `Il manque encore ${String(missing)} média${missing > 1 ? 's' : ''}. Touche un carton pour le compléter.`}
      </p>
      <ul className="sk-preview__list">
        {/* What is missing first: she sees it without looking for it; then the cards ready, in the script's order. */}
        {cards
          .map((card, index) => ({ card, index }))
          .toSorted((a, b) => Number(cardDone(a.card, files)) - Number(cardDone(b.card, files)))
          .map(({ card, index }) => {
            const done = cardDone(card, files);
            const meta = cardMeta(card, files);
            return (
              <li key={`${card.segmentKey}:${card.variant ?? ''}`}>
                <button
                  type="button"
                  className="nv-plate sk-row"
                  onClick={() => {
                    onOpen(index);
                  }}
                >
                  <img
                    className="sk-row__image"
                    src={cardUrl(dropId, card.segmentKey, card.variant)}
                    width={1080}
                    height={1080}
                    alt=""
                    loading="lazy"
                  />
                  <span className="sk-row__titles">
                    <span className="sk-row__name">
                      <span className="sk-code nv-num">{card.code}</span> {card.title}
                    </span>
                    <span className="sk-row__meta nv-num">{meta}</span>
                  </span>
                  <span className={done ? 'sk-pill sk-pill--ok' : 'sk-pill sk-pill--warn'}>
                    {done ? 'Prêt' : 'À compléter'}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
