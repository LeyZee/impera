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
import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import { Thumb } from './Thumb';
import {
  CONTENT_KEY,
  Refused,
  cardUrl,
  fillSlot,
  scriptDropKey,
  submitScript,
  useScriptDrop,
  withdrawDrop,
} from './api';
import { durationOf } from './media-length';
import { UNKNOWN_TYPE, fileLine, isInterrupted, mimeOf, pickedHeadRefusal, type LiveSend } from './model';
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
import { holds, isSending, queueSend, retryNow, sendAgain, useLiveSends } from './sends';

import { lookAgainAtHerCase } from '@/rewards/api';
import { Page, PageHeader } from '@/shell/layout';
import { Failure } from '@/shell/states';

import './content.css';
import './script.css';

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
    const first = cards.findIndex((card) => !cardDone(card, drop.files, sends));
    setStep(first === -1 ? cards.length : first);
  }, [step, drop, cards, segments, sends]);

  const reread = (): void => {
    void client.invalidateQueries({ queryKey: scriptDropKey(dropId) });
    void client.invalidateQueries({ queryKey: CONTENT_KEY });
    // A drop arrived may earn her something: her case is read again once the game has looked (CRE-06).
    lookAgainAtHerCase(client);
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
          <Failure
            onRetry={() => {
              void script.refetch();
            }}
          >
            Rien n’est perdu : ce que tu as envoyé est gardé.
          </Failure>
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

  const progress = progressOf(cards, files, sends);
  const filling = drop.state === 'filling';
  const card = cards[step];
  const firstMissing = cards.findIndex((one) => !cardDone(one, files, sends));
  const percent = progress.required === 0 ? 100 : Math.round((100 * progress.filled) / progress.required);
  // Précédent / Suivant: beside the slots on a computer (under them on a phone), under the preview.
  const foot: ReactNode = filling ? (
    <>
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
              Compléter le carton {firstMissing + 1}
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
      <Withdraw
        dropId={dropId}
        onWithdrawn={() => {
          void client.invalidateQueries({ queryKey: CONTENT_KEY });
          onBack();
        }}
      />
    </>
  ) : null;

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
            sends={sends}
            missing={progress.required - progress.filled}
            onOpen={go}
          />
        ) : (
          <CardStep
            key={`${card.segmentKey}:${card.variant ?? ''}`}
            dropId={dropId}
            card={card}
            number={step + 1}
            foot={foot}
            onRetry={(fileId) => {
              sendAgain([fileId], reread);
            }}
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

        {card === undefined ? foot : null}
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
  number,
  foot,
  onRetry,
  files,
  sends,
  chosen,
  onFilled,
  onResumed,
}: {
  dropId: ContentDropId;
  card: ScriptCard;
  /** Its place in her script, from 1: « Carton 3 », never the agency's code (recette CRE-14). */
  number: number;
  foot: ReactNode;
  onRetry: (fileId: ContentDropFileId) => void;
  files: readonly ContentDropFile[];
  sends: ReadonlyMap<string, LiveSend>;
  chosen: ReadonlyMap<ContentDropFileId, File>;
  onFilled: (file: File, declared: { id: ContentDropFileId }, next: ContentDrop) => void;
  onResumed: (fileId: ContentDropFileId, file: File) => void;
}): JSX.Element {
  // On a computer, two columns (recette CRE-13): the card on the left, held in view; what to do on the right.
  return (
    <section className="sk-card nv-enter" aria-labelledby="sk-card-title">
      <img
        className="sk-card__image"
        src={cardUrl(dropId, card.segmentKey, card.variant)}
        width={1080}
        height={1080}
        alt={`Carton ${String(number)} : ${card.title}`}
      />
      <div className="sk-card__work">
        <h2 id="sk-card-title" className="nv-h2 sk-card__title">
          {card.title}
        </h2>
        {card.detail === null ? null : <p className="sk-card__detail">{card.detail}</p>}
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
              onRetry={onRetry}
            />
          ))}
        </ul>
        {foot}
      </div>
    </section>
  );
}

/** « Retirer ce script », away from « Continuer » (recette CRE-12), and asked once more before it goes. */
function Withdraw({ dropId, onWithdrawn }: { dropId: ContentDropId; onWithdrawn: () => void }): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="sk-withdraw">
      {asking ? (
        <>
          <span className="sk-withdraw__ask">
            Retirer ce script ? Les médias déjà ajoutés partent avec lui.
          </span>
          <span className="sk-withdraw__row">
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setAsking(false);
              }}
            >
              Garder
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--destructive nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFailed(false);
                withdrawDrop(dropId)
                  .then(onWithdrawn)
                  .catch(() => {
                    setFailed(true);
                    setBusy(false);
                  });
              }}
            >
              Retirer
            </button>
          </span>
        </>
      ) : (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm sk-withdraw__open"
          onClick={() => {
            setAsking(true);
          }}
        >
          Retirer ce script
        </button>
      )}
      {failed ? (
        <p className="sk-foot__alert" role="alert">
          Le retrait n’est pas passé : réessaie dans un instant.
        </p>
      ) : null}
    </div>
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
  onRetry,
}: {
  dropId: ContentDropId;
  slot: ScriptSlot;
  rank: number;
  file: ContentDropFile | undefined;
  sends: ReadonlyMap<string, LiveSend>;
  chosen: ReadonlyMap<ContentDropFileId, File>;
  onFilled: (file: File, declared: { id: ContentDropFileId }, next: ContentDrop) => void;
  onResumed: (fileId: ContentDropFileId, file: File) => void;
  onRetry: (fileId: ContentDropFileId) => void;
}): JSX.Element {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const live = file === undefined ? undefined : sends.get(file.id);
  const local = file === undefined ? undefined : chosen.get(file.id);
  const interrupted = file !== undefined && isInterrupted(file, live);
  const stalled = file?.state === 'awaiting' && live?.phase === 'stalled';
  // Cut while this page was open: the phone still holds the file, « Réessayer » sends it again without the gallery.
  const held = file !== undefined && interrupted && holds(file.id);
  const percent =
    live === undefined || live.total === 0 ? 0 : Math.min(100, Math.floor((100 * live.sent) / live.total));
  const showsBar =
    file?.state === 'awaiting' &&
    live !== undefined &&
    (live.phase === 'sending' || live.phase === 'waiting' || live.phase === 'stalled');
  const warn = file?.state === 'refused' || interrupted || stalled;

  const choose = async (picked: File): Promise<void> => {
    setRefusal(null);
    // The same file again after a cut send: it goes on where it stopped (the server checks its bytes anyway).
    if (file !== undefined && interrupted && picked.size === file.bytes) {
      // Its first bytes too (recette CRE-12): a file of the same size that is not what was declared never goes up.
      const head = await pickedHeadRefusal(picked, file.mime);
      if (head !== null) {
        setRefusal(head);
        return;
      }
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
    // Its first bytes before anything goes (recette CRE-12): a text renamed `.jpg` never fills a slot.
    const head = await pickedHeadRefusal(picked, mime);
    if (head !== null) {
      setRefusal(head);
      setBusy(false);
      return;
    }
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
          className={live.phase === 'sending' ? 'nv-gauge' : 'nv-gauge nv-gauge--amber'}
          role="progressbar"
          aria-label={`Envoi du média ${String(rank)}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="nv-gauge__fill" style={{ '--nv-gauge-value': `${String(percent)}%` }} />
        </div>
      ) : null}
      {interrupted && !held ? (
        <p className="sk-slot__resume">Touche « Reprendre » et rechoisis le même fichier dans ta galerie.</p>
      ) : null}
      {refusal === null ? null : (
        <p className="sk-slot__refusal" role="alert">
          {refusal}
        </p>
      )}
      <div className="sk-slot__actions">
        {file !== undefined && (stalled || held) ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              if (stalled) retryNow(file.id);
              else onRetry(file.id);
            }}
          >
            Réessayer
          </button>
        ) : (
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
        )}
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
  sends,
  missing,
  onOpen,
}: {
  dropId: ContentDropId;
  cards: readonly ScriptCard[];
  files: readonly ContentDropFile[];
  sends: ReadonlyMap<string, LiveSend>;
  missing: number;
  onOpen: (step: number) => void;
}): JSX.Element {
  return (
    <section className="sk-preview nv-enter" aria-labelledby="sk-preview-title">
      <h2 id="sk-preview-title" className="nv-h2 sk-preview__title">
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
          .toSorted((a, b) => Number(cardDone(a.card, files, sends)) - Number(cardDone(b.card, files, sends)))
          .map(({ card, index }) => {
            const done = cardDone(card, files, sends);
            const meta = cardMeta(card, files, sends);
            const refused = card.slots.some((slot) => fileOfSlot(files, slot.key)?.state === 'refused');
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
                  {/* Its number in her script, its whole title (it wraps), its count: amber is kept for a refusal. */}
                  <span className="sk-row__titles">
                    <span className="sk-row__name">
                      <span className="sk-row__number nv-num">{index + 1}</span>
                      {/* The series tell the cards of one stage apart (« Teasing · Série B »). */}
                      {card.variant === null ? card.title : `${card.title} · Série ${card.variant}`}
                    </span>
                    <span className={refused ? 'sk-row__meta sk-row__meta--warn' : 'sk-row__meta nv-num'}>
                      {refused ? `${meta} · un média refusé, à remplacer` : meta}
                    </span>
                  </span>
                  {done ? (
                    <span className="sk-row__done" role="img" aria-label="Complet">
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M5 10.5l3.2 3.2L15 7" />
                      </svg>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
