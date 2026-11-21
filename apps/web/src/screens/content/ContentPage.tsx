import {
  DROP_CATEGORY_LABELS,
  type ContentDrop,
  type ContentDropFile,
  type ContentRequest,
  ContentDropIdSchema,
  type ContentDropId,
  type DropCategory,
  type RedoneDrop,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { DropSheet } from './DropSheet';
import { CONTENT_KEY, refuseRequest, startScriptDrop, useContent, useScriptDrop, withdrawDrop } from './api';
import {
  CATEGORY_EMOJIS,
  CATEGORY_HINTS,
  DROP_OUTPUTS,
  STATE_WORDS,
  contentsOf,
  dropName,
  droppedOn,
  dueNow,
  dueOf,
  fileLine,
  isInterrupted,
  matchResumed,
  onTheirWay,
  pickedHeadRefusal,
  outLine,
  published,
  mayWithdrawHere,
  refusedOf,
  routeFirst,
  shotMomentOf,
  stateTone,
  toRedo,
  toShoot,
  type LiveSend,
} from './model';
import { progressOf, scriptCards } from './script-model';
import { holds, isSending, queueSend, retryNow, sendAgain, useLiveSends } from './sends';

import { useGrowingArea } from '@/lib/growing-area';
import { lookAgainAtHerCase } from '@/rewards/api';
import { dayOf, readerZone } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Dialog } from '@/shell/Dialog';
import { Page, PageHeader } from '@/shell/layout';
import { Failure } from '@/shell/states';

import './content.css';

/** What the sheet opens on: a tile (a category), or a request (its category, and the request it answers). */
interface Opened {
  readonly category: DropCategory;
  readonly request: ContentRequest | null;
}

/**
 * Contenu, the creator's (CR-06 d, ADR 0055 § 8), in the order of what matters to her: À tourner, Déposer, En route,
 * Publié. An empty section is not shown (relecture Extension); amber only where she has something to do.
 */
export function ContentPage({
  onOpenScript,
  asked: askedId = null,
  onAsked,
}: {
  /** Her script, card by card (SC-02 lot b2). */
  onOpenScript: (dropId: ContentDropId) => void;
  /** A request to open the sheet on, from Aujourd'hui's « Déposer » (`?demande=`, recette visuelle 16/11, CRE-01). */
  asked?: string | null;
  /** The sheet opened on it: the address forgets it, so that « retour » does not open it again. */
  onAsked?: () => void;
}): JSX.Element {
  const content = useContent();
  const client = useQueryClient();
  const sends = useLiveSends();
  const now = useNow();
  const zone = readerZone();
  const today = dayOf(now, zone);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [refusing, setRefusing] = useState<ContentRequest | null>(null);
  /** The drop she just sent from the sheet: the page goes to it, so that she sees it leave (recette CRE-09). */
  const [landed, setLanded] = useState<ContentDropId | null>(null);

  // A send under way survives neither a reload nor leaving the page: the browser asks before.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (isSending()) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, []);

  const reread = (): void => {
    void client.invalidateQueries({ queryKey: CONTENT_KEY });
    // A drop arrived may earn her something: her case is read again once the game has looked (CRE-06).
    lookAgainAtHerCase(client);
  };

  const asked = content.data === undefined ? [] : toShoot(content.data.requests, content.data.drops);
  // What the agency sent back without a request (trou 7 du 21/11): above what is asked, she redoes it first.
  const redo = content.data === undefined ? [] : toRedo(content.data.redone, content.data.drops);
  // The first thing due, late or for today, carries the screen's one neon (recette visuelle 16/11, CRE-13).
  const first = dueNow(asked, today)[0];
  const firstKey = first === undefined ? null : first.kind === 'script' ? first.drop.id : first.request.id;

  // Aujourd'hui's « Déposer »: the sheet opens on its request once Contenu is read, then the address forgets it.
  const requests = content.data?.requests;
  useEffect(() => {
    if (askedId === null || requests === undefined) return;
    const request = requests.find((one) => one.id === askedId && one.state === 'open' && one.dropId === null);
    // A script asked with its version is begun card by card, from its own card: the page shows it.
    if (request !== undefined && !(request.category === 'script' && request.structureVersionId !== null))
      setOpened({ category: request.category, request });
    onAsked?.();
  }, [askedId, requests, onAsked]);
  const moving = content.data === undefined ? [] : onTheirWay(content.data.drops);
  const out = content.data === undefined ? [] : published(content.data.drops);

  const onTheWay =
    moving.length === 0 ? null : (
      <section className="ct-section" aria-labelledby="ct-moving">
        <h2 id="ct-moving" className="nv-h2 ct-section__title">
          En route
        </h2>
        <ul className="ct-list">
          {moving.map((drop) => (
            <DropCard
              key={drop.id}
              drop={drop}
              sends={sends}
              landed={drop.id === landed}
              when={droppedOn(drop.createdAt, today, zone)}
              onSettled={reread}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <Page className="ct-page" width="narrow">
      <PageHeader title="Contenu" lead="Ce qu’on te demande, et ce que tu envoies." />
      {content.isError ? (
        <Failure
          onRetry={() => {
            void content.refetch();
          }}
        >
          Rien ici n’est à jour en attendant.
        </Failure>
      ) : content.data === undefined ? (
        <div className="ct-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <div className="ct-sections nv-enter">
          {asked.length === 0 && redo.length === 0 ? null : (
            <section className="ct-section" aria-labelledby="ct-asked">
              <h2 id="ct-asked" className="nv-h2 ct-section__title">
                À tourner
              </h2>
              <ul className="ct-list">
                {redo.map((one, index) => (
                  <RedoneCard
                    key={one.dropId}
                    // The screen's one neon goes to what is due first; without one, to the latest sent back.
                    first={firstKey === null && index === 0}
                    redone={one}
                    onDrop={() => {
                      setOpened({ category: one.category, request: null });
                    }}
                  />
                ))}
                {asked.map((item) =>
                  item.kind === 'script' ? (
                    <StartedScriptCard
                      key={item.drop.id}
                      first={item.drop.id === firstKey}
                      drop={item.drop}
                      request={item.request}
                      today={today}
                      sends={sends}
                      onOpenScript={onOpenScript}
                    />
                  ) : (
                    <RequestCard
                      key={item.request.id}
                      first={item.request.id === firstKey}
                      request={item.request}
                      today={today}
                      onDrop={() => {
                        setOpened({ category: item.request.category, request: item.request });
                      }}
                      onOpenScript={onOpenScript}
                      onRefuse={() => {
                        setRefusing(item.request);
                      }}
                    />
                  ),
                )}
              </ul>
            </section>
          )}

          {/* While a file of it is still to go up, « En route » comes before « Déposer » (recette CRE-09). */}
          {routeFirst(moving) ? onTheWay : null}

          <section className="ct-section" aria-labelledby="ct-drop">
            {/* Not « Déposer », the word of every request's button above: these tiles send without a request (CRE-13). */}
            <h2 id="ct-drop" className="nv-h2 ct-section__title">
              Envoyer autre chose
            </h2>
            {DROP_OUTPUTS.map((output) => (
              <div key={output.name} className="ct-output">
                {DROP_OUTPUTS.length > 1 ? <h3 className="nv-h3 ct-output__name">{output.name}</h3> : null}
                <div className="ct-tiles">
                  {output.categories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className="nv-plate ct-tile"
                      onClick={() => {
                        setOpened({ category, request: null });
                      }}
                    >
                      <span className="ct-tile__emoji" aria-hidden="true">
                        {CATEGORY_EMOJIS[category]}
                      </span>
                      <span className="ct-tile__name">{DROP_CATEGORY_LABELS[category]}</span>
                      <span className="ct-tile__hint">{CATEGORY_HINTS[category]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {routeFirst(moving) ? null : onTheWay}

          {out.length === 0 ? null : (
            <section className="ct-section" aria-labelledby="ct-out">
              <h2 id="ct-out" className="nv-h2 ct-section__title">
                Publié
              </h2>
              <ul className="ct-list ct-list--quiet">
                {out.map((drop) => (
                  <li key={drop.id} className="ct-out">
                    <span aria-hidden="true">{CATEGORY_EMOJIS[drop.category]}</span>
                    <span className="ct-out__name">{dropName(drop)}</span>
                    <span className="ct-out__meta nv-num">{outLine(drop, today, zone)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {opened === null ? null : (
        <DropSheet
          category={opened.category}
          request={opened.request}
          onClose={() => {
            setOpened(null);
          }}
          onDropped={(drop, files) => {
            setOpened(null);
            setLanded(drop.id);
            client.setQueryData(CONTENT_KEY, (old: typeof content.data) =>
              old === undefined
                ? old
                : { ...old, drops: [drop, ...old.drops.filter((d) => d.id !== drop.id)] },
            );
            for (const sent of drop.files) {
              const file = files.get(sent.id);
              if (file !== undefined && sent.state === 'awaiting')
                void queueSend(drop.id, sent.id, file, reread);
            }
            reread();
          }}
        />
      )}
      {refusing === null ? null : (
        <RefuseDialog
          request={refusing}
          onClose={() => {
            setRefusing(null);
          }}
          onRefused={() => {
            setRefusing(null);
            reread();
          }}
        />
      )}
    </Page>
  );
}

/** « Pour aujourd’hui » in ink and bold, a late day in amber, the others quiet (recette visuelle 16/11, CRE-13). */
const dueClass = (
  due: { readonly text: string; readonly late: boolean },
  request: ContentRequest,
  today: string,
) => (due.late ? 'ct-due ct-due--late' : request.dueOn === today ? 'ct-due ct-due--today' : 'ct-due');

function RequestCard({
  first,
  request,
  today,
  onDrop,
  onRefuse,
  onOpenScript,
}: {
  /** The first thing due: its button is the screen's neon. */
  first: boolean;
  request: ContentRequest;
  today: string;
  onDrop: () => void;
  onRefuse: () => void;
  onOpenScript: (dropId: ContentDropId) => void;
}): JSX.Element {
  const due = dueOf(request.dueOn, today);
  const moment = shotMomentOf(request);
  // A script asked with its version is shot card by card; one asked before (no version) is dropped as before.
  const scripted = request.category === 'script' && request.structureVersionId !== null;
  const [dropId] = useState(() => ContentDropIdSchema.parse(crypto.randomUUID()));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <li className="nv-plate ct-card">
      <div className="ct-card__head">
        <span className="ct-card__emoji" aria-hidden="true">
          {CATEGORY_EMOJIS[request.category]}
        </span>
        <span className="ct-card__titles">
          <span className="ct-card__name">{DROP_CATEGORY_LABELS[request.category]}</span>
          <span className={dueClass(due, request, today)}>
            {moment === null ? due.text : `${due.text} · ${moment}`}
          </span>
        </span>
      </div>
      <p className="ct-card__why">{request.reason}</p>
      {request.redo === null || request.dropId !== null ? null : (
        <RedoNote sentence={request.redo.sentence} />
      )}
      {request.dropId === null ? (
        <div className="ct-card__foot">
          <button type="button" className="nv-btn nv-btn--plain nv-btn--sm ct-card__cant" onClick={onRefuse}>
            Je ne peux pas
          </button>
          {scripted ? (
            <button
              type="button"
              className={`nv-btn ${first ? 'nv-btn--neon' : 'nv-btn--soft'} nv-btn--sm`}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFailed(null);
                // Its id drawn once: a tap replayed after a cut network answers the same script.
                startScriptDrop({ id: dropId, requestId: request.id })
                  .then((script) => {
                    onOpenScript(script.drop.id);
                  })
                  .catch(() => {
                    setFailed('Ton script n’a pas pu s’ouvrir : réessaie dans un instant.');
                    setBusy(false);
                  });
              }}
            >
              Commencer
            </button>
          ) : (
            <button
              type="button"
              className={`nv-btn ${first ? 'nv-btn--neon' : 'nv-btn--soft'} nv-btn--sm`}
              onClick={onDrop}
            >
              Déposer
            </button>
          )}
        </div>
      ) : (
        // Her drop for it still goes up (recette CRE-12): no second drop, she finishes the one on its way.
        <p className="ct-card__meta">
          Ton dépôt est en route. S’il s’arrête, reprends-le dans «&nbsp;En route&nbsp;».
        </p>
      )}
      {failed === null ? null : (
        <p className="ct-card__blocked" role="alert">
          {failed}
        </p>
      )}
    </li>
  );
}

/** The agency's « À refaire » on her card (trou 7 du 21/11): amber, she has something to do; its words as written. */
function RedoNote({ sentence }: { sentence: string }): JSX.Element {
  return (
    <div className="ct-redo">
      <span className="ct-redo__tag">À refaire</span>
      <p className="ct-redo__why">{sentence}</p>
    </div>
  );
}

/** A drop of hers the agency sent back without a request (trou 7 du 21/11): what it was, why, and « Déposer » again. */
function RedoneCard({
  first,
  redone,
  onDrop,
}: {
  first: boolean;
  redone: RedoneDrop;
  onDrop: () => void;
}): JSX.Element {
  return (
    <li className="nv-plate ct-card">
      <div className="ct-card__head">
        <span className="ct-card__emoji" aria-hidden="true">
          {CATEGORY_EMOJIS[redone.category]}
        </span>
        <span className="ct-card__titles">
          <span className="ct-card__name">{DROP_CATEGORY_LABELS[redone.category]}</span>
          <span className="ct-due">Ton dernier envoi est revenu</span>
        </span>
      </div>
      <RedoNote sentence={redone.redo.sentence} />
      <div className="ct-card__foot">
        <button
          type="button"
          className={`nv-btn ${first ? 'nv-btn--neon' : 'nv-btn--soft'} nv-btn--sm`}
          onClick={onDrop}
        >
          Déposer à nouveau
        </button>
      </div>
    </li>
  );
}

/**
 * A script she began and has not sent (recette CRE-12): it keeps its place in « À tourner », with its name, its day,
 * how far she is and « Continuer ». « Retirer » lives in the script itself, away from « Continuer ».
 */
function StartedScriptCard({
  first,
  drop,
  request,
  today,
  sends,
  onOpenScript,
}: {
  /** The first thing due: « Continuer » is the screen's neon. */
  first: boolean;
  drop: ContentDrop;
  request: ContentRequest | null;
  today: string;
  sends: ReadonlyMap<string, LiveSend>;
  onOpenScript: (dropId: ContentDropId) => void;
}): JSX.Element {
  const script = useScriptDrop(drop.id);
  const segments = script.data?.segments;
  const cards = useMemo(() => (segments === undefined ? [] : scriptCards(segments)), [segments]);
  const progress = script.data === undefined ? null : progressOf(cards, script.data.drop.files, sends);
  const due = request === null ? null : dueOf(request.dueOn, today);
  const moment = request === null ? null : shotMomentOf(request);
  const percent =
    progress === null || progress.required === 0
      ? 0
      : Math.round((100 * progress.filled) / progress.required);
  return (
    <li className="nv-plate ct-card">
      <div className="ct-card__head">
        <span className="ct-card__emoji" aria-hidden="true">
          {CATEGORY_EMOJIS[drop.category]}
        </span>
        <span className="ct-card__titles">
          <span className="ct-card__name">
            {script.data === undefined
              ? DROP_CATEGORY_LABELS[drop.category]
              : `${DROP_CATEGORY_LABELS[drop.category]} · ${script.data.name}`}
          </span>
          {due === null || request === null ? null : (
            <span className={dueClass(due, request, today)}>
              {moment === null ? due.text : `${due.text} · ${moment}`}
            </span>
          )}
        </span>
        <span className="ct-state ct-state--calm">Commencé</span>
      </div>
      {progress === null ? null : (
        <div className="ct-begun">
          <span className="ct-begun__count nv-num">
            {progress.filled} / {progress.required} médias
          </span>
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
      )}
      <div className="ct-card__foot">
        <button
          type="button"
          className={`nv-btn ${first ? 'nv-btn--neon' : 'nv-btn--soft'} nv-btn--sm`}
          onClick={() => {
            onOpenScript(drop.id);
          }}
        >
          Continuer
        </button>
      </div>
    </li>
  );
}

function DropCard({
  drop,
  sends,
  landed,
  when,
  onSettled,
}: {
  drop: ContentDrop;
  sends: ReadonlyMap<string, LiveSend>;
  /** Just sent from the sheet: the page goes to it once (recette CRE-09). */
  landed: boolean;
  when: string;
  onSettled: () => void;
}): JSX.Element {
  const card = useRef<HTMLLIElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState(0);
  // A file picked again whose first bytes are not what it was declared as (recette CRE-12): never sent, said here.
  const [notIt, setNotIt] = useState<string | null>(null);
  const tone = stateTone(drop);
  const refused = refusedOf(drop);
  const sending = drop.files.some((file) => {
    const live = sends.get(file.id);
    return (
      file.state === 'awaiting' && live !== undefined && live.phase !== 'done' && live.phase !== 'failed'
    );
  });
  const interrupted = drop.files.filter((file) => isInterrupted(file, sends.get(file.id)));
  // Cut while this page was open: the phone still holds every file, « Réessayer » sends them again.
  const allHeld = interrupted.length > 0 && interrupted.every((file) => holds(file.id));

  useEffect(() => {
    if (!landed) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.current?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [landed]);

  return (
    <li ref={card} className="nv-plate ct-card">
      <div className="ct-card__head">
        <span className="ct-card__emoji" aria-hidden="true">
          {CATEGORY_EMOJIS[drop.category]}
        </span>
        <span className="ct-card__name">{dropName(drop)}</span>
        <span className={`ct-state ct-state--${tone}`}>{STATE_WORDS[drop.state]}</span>
      </div>
      <p className="ct-card__meta nv-num">
        {when} · {drop.files.length === 0 ? 'Rien d’ajouté encore' : contentsOf(drop.files)}
      </p>
      {/* Said while it goes up, to her and to a screen reader: leaving the app stops the send. */}
      <p className="ct-card__live" role="status">
        {sending ? 'Envoi en cours : garde l’appli ouverte jusqu’à la fin.' : ''}
      </p>
      {interrupted.length === 0 || sending ? null : (
        <div className="ct-resume">
          <p className="ct-resume__text">
            {allHeld
              ? 'L’envoi s’est arrêté.'
              : 'L’envoi s’est arrêté. Rechoisis les mêmes fichiers dans ta galerie : il reprend où il en était.'}
          </p>
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              if (allHeld) {
                sendAgain(
                  interrupted.map((file) => file.id),
                  onSettled,
                );
                return;
              }
              picker.current?.click();
            }}
          >
            {allHeld ? 'Réessayer' : 'Reprendre l’envoi'}
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])];
              event.target.value = '';
              const { pairs, unmatched: left } = matchResumed(interrupted, picked);
              setUnmatched(left);
              setNotIt(null);
              for (const pair of pairs) {
                const mime = interrupted.find((file) => file.id === pair.fileId)?.mime;
                if (mime === undefined) continue;
                void pickedHeadRefusal(pair.file, mime).then((refusal) => {
                  if (refusal === null) void queueSend(drop.id, pair.fileId, pair.file, onSettled);
                  else setNotIt(refusal);
                });
              }
            }}
          />
          {unmatched === 0 ? null : (
            <p className="ct-file__hint">
              {unmatched === 1
                ? 'Un fichier choisi n’est pas de ce dépôt : choisis ceux que tu avais envoyés.'
                : `${String(unmatched)} fichiers choisis ne sont pas de ce dépôt : choisis ceux que tu avais envoyés.`}
            </p>
          )}
          {notIt === null ? null : <p className="ct-file__hint">{notIt}</p>}
        </div>
      )}
      {drop.state === 'blocked' && drop.blockedReason !== null ? (
        <p className="ct-card__blocked">{drop.blockedReason}</p>
      ) : null}
      {drop.sentence === null ? null : <p className="ct-card__why">« {drop.sentence} »</p>}
      {drop.state === 'uploading' || drop.state === 'received' ? (
        <ul className="ct-files">
          {drop.files.map((file) => (
            <FileLine key={file.id} file={file} live={sends.get(file.id)} />
          ))}
        </ul>
      ) : refused.length > 0 ? (
        // Ready or blocked, each refused file keeps its line and its reason: she knows what to shoot again and why,
        // never only « Aucun fichier n'a pu être gardé » (recette MED-03).
        <ul className="ct-files">
          {refused.map((file) => (
            <FileLine key={file.id} file={file} live={undefined} />
          ))}
        </ul>
      ) : null}
      {mayWithdrawHere(drop) && !sending ? (
        <div className="ct-card__actions">
          {confirming ? (
            <>
              <span className="ct-card__ask">Retirer ce dépôt ?</span>
              <button
                type="button"
                className="nv-btn nv-btn--destructive nv-btn--sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setFailed(null);
                  withdrawDrop(drop.id)
                    .then(onSettled)
                    .catch(() => {
                      setFailed('Le retrait n’est pas passé : réessaie dans un instant.');
                    })
                    .finally(() => {
                      setBusy(false);
                      setConfirming(false);
                    });
                }}
              >
                Retirer
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Garder
              </button>
            </>
          ) : (
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Retirer
            </button>
          )}
        </div>
      ) : null}
      {failed === null ? null : (
        <p className="ct-card__blocked" role="alert">
          {failed}
        </p>
      )}
    </li>
  );
}

/**
 * A file's line: its progress while it goes up here; when the server keeps answering with an error, it says so in
 * amber with « Réessayer » (recette CRE-10). A cut send is resumed once, at the head of its card.
 */
function FileLine({ file, live }: { file: ContentDropFile; live: LiveSend | undefined }): JSX.Element {
  const line = fileLine(file, live);
  const percent =
    live === undefined || live.total === 0 ? 0 : Math.min(100, Math.floor((100 * live.sent) / live.total));
  const showsBar =
    file.state === 'awaiting' &&
    live !== undefined &&
    (live.phase === 'sending' || live.phase === 'waiting' || live.phase === 'stalled');
  const stalled = file.state === 'awaiting' && live?.phase === 'stalled';
  const warn = file.state === 'refused' || stalled || isInterrupted(file, live);
  const label = `${file.kind === 'image' ? 'Photo' : file.kind === 'video' ? 'Vidéo' : 'Vocal'} ${String(file.position + 1)}`;
  return (
    <li className="ct-file">
      <div className="ct-file__row">
        <span className="ct-file__name">{label}</span>
        <span className={warn ? 'ct-file__line ct-file__line--warn' : 'ct-file__line nv-num'}>{line}</span>
        {stalled ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              retryNow(file.id);
            }}
          >
            Réessayer
          </button>
        ) : null}
      </div>
      {showsBar ? (
        <div
          className={live.phase === 'sending' ? 'nv-gauge' : 'nv-gauge nv-gauge--amber'}
          role="progressbar"
          aria-label={`Envoi de ${label}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="nv-gauge__fill" style={{ '--nv-gauge-value': `${String(percent)}%` }} />
        </div>
      ) : null}
    </li>
  );
}

function RefuseDialog({
  request,
  onClose,
  onRefused,
}: {
  request: ContentRequest;
  onClose: () => void;
  onRefused: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const area = useGrowingArea(reason);
  return (
    <Dialog
      title="Tu ne peux pas le tourner ?"
      lead={`${CATEGORY_EMOJIS[request.category]} ${DROP_CATEGORY_LABELS[request.category]}`}
      busy={busy}
      onClose={onClose}
    >
      <form
        className="ct-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setFailed(false);
          const said = reason.trim();
          refuseRequest(request.id, said === '' ? null : said)
            .then(onRefused)
            .catch(() => {
              setFailed(true);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <label className="nv-field">
          <span className="nv-field__label">Dis-nous pourquoi, si tu veux</span>
          <textarea
            ref={area}
            className="nv-field__control ct-reason"
            rows={3}
            maxLength={200}
            value={reason}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </label>
        {failed ? (
          <p className="ct-card__blocked" role="alert">
            Ce n’est pas passé : réessaie dans un instant.
          </p>
        ) : null}
        <div className="ct-form__actions">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy}>
            Prévenir l’agence
          </button>
        </div>
      </form>
    </Dialog>
  );
}
