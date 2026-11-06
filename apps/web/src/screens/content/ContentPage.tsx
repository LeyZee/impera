import {
  DROP_CATEGORY_LABELS,
  type ContentDrop,
  type ContentDropFile,
  type ContentRequest,
  ContentDropIdSchema,
  type ContentDropId,
  type DropCategory,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX } from 'react';

import { DropSheet } from './DropSheet';
import { CONTENT_KEY, refuseRequest, startScriptDrop, useContent, withdrawDrop } from './api';
import {
  CATEGORY_EMOJIS,
  CATEGORY_HINTS,
  DROP_OUTPUTS,
  STATE_WORDS,
  contentsOf,
  droppedOn,
  dueOf,
  fileLine,
  onTheirWay,
  openRequests,
  published,
  mayWithdrawHere,
  refusedOf,
  shotMomentOf,
  stateTone,
  type LiveSend,
} from './model';
import { isSending, queueSend, useLiveSends } from './sends';

import { dayOf, readerZone } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Dialog } from '@/shell/Dialog';
import { ServerSilent } from '@/shell/ServerSilent';
import { Page, PageHeader } from '@/shell/layout';

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
}: {
  /** Her script, card by card (SC-02 lot b2). */
  onOpenScript: (dropId: ContentDropId) => void;
}): JSX.Element {
  const content = useContent();
  const client = useQueryClient();
  const sends = useLiveSends();
  const now = useNow();
  const zone = readerZone();
  const today = dayOf(now, zone);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [refusing, setRefusing] = useState<ContentRequest | null>(null);

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
  };

  const requests = content.data === undefined ? [] : openRequests(content.data.requests);
  const moving = content.data === undefined ? [] : onTheirWay(content.data.drops);
  const out = content.data === undefined ? [] : published(content.data.drops);

  return (
    <Page className="ct-page">
      <PageHeader title="Contenu" lead="Ce qu’on te demande, et ce que tu envoies." />
      {content.isError ? (
        <ServerSilent
          text="Ton contenu n’a pas pu être lu. Rien ici n’est à jour en attendant."
          onRetry={() => {
            void content.refetch();
          }}
        />
      ) : content.data === undefined ? (
        <div className="ct-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <div className="ct-sections nv-enter">
          {requests.length === 0 ? null : (
            <section className="ct-section" aria-labelledby="ct-asked">
              <h2 id="ct-asked" className="ct-section__title">
                À tourner
              </h2>
              <ul className="ct-list">
                {requests.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    today={today}
                    onDrop={() => {
                      setOpened({ category: request.category, request });
                    }}
                    onOpenScript={onOpenScript}
                    onRefuse={() => {
                      setRefusing(request);
                    }}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="ct-section" aria-labelledby="ct-drop">
            <h2 id="ct-drop" className="ct-section__title">
              Déposer
            </h2>
            {DROP_OUTPUTS.map((output) => (
              <div key={output.name} className="ct-output">
                {DROP_OUTPUTS.length > 1 ? <h3 className="ct-output__name">{output.name}</h3> : null}
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

          {moving.length === 0 ? null : (
            <section className="ct-section" aria-labelledby="ct-moving">
              <h2 id="ct-moving" className="ct-section__title">
                En route
              </h2>
              <ul className="ct-list">
                {moving.map((drop) => (
                  <DropCard
                    key={drop.id}
                    drop={drop}
                    sends={sends}
                    when={droppedOn(drop.createdAt, today, zone)}
                    onSettled={reread}
                    onOpenScript={onOpenScript}
                  />
                ))}
              </ul>
            </section>
          )}

          {out.length === 0 ? null : (
            <section className="ct-section" aria-labelledby="ct-out">
              <h2 id="ct-out" className="ct-section__title">
                Publié
              </h2>
              <ul className="ct-list ct-list--quiet">
                {out.map((drop) => (
                  <li key={drop.id} className="ct-out">
                    <span aria-hidden="true">{CATEGORY_EMOJIS[drop.category]}</span>
                    <span className="ct-out__name">{DROP_CATEGORY_LABELS[drop.category]}</span>
                    <span className="ct-out__meta nv-num">
                      {contentsOf(drop.files)} · {droppedOn(drop.createdAt, today, zone)}
                    </span>
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

function RequestCard({
  request,
  today,
  onDrop,
  onRefuse,
  onOpenScript,
}: {
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
          <span className={due.late ? 'ct-due ct-due--late' : 'ct-due'}>
            {moment === null ? due.text : `${due.text} · ${moment}`}
          </span>
        </span>
      </div>
      <p className="ct-card__why">{request.reason}</p>
      <div className="ct-card__foot">
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={onRefuse}>
          Je ne peux pas
        </button>
        {scripted ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
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
          <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onDrop}>
            Déposer
          </button>
        )}
      </div>
      {failed === null ? null : (
        <p className="ct-card__blocked" role="alert">
          {failed}
        </p>
      )}
    </li>
  );
}

function DropCard({
  drop,
  sends,
  when,
  onSettled,
  onOpenScript,
}: {
  drop: ContentDrop;
  sends: ReadonlyMap<string, LiveSend>;
  when: string;
  onSettled: () => void;
  onOpenScript: (dropId: ContentDropId) => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const tone = stateTone(drop);
  const refused = refusedOf(drop);
  const sending = drop.files.some((file) => {
    const live = sends.get(file.id);
    return (
      file.state === 'awaiting' && live !== undefined && live.phase !== 'done' && live.phase !== 'failed'
    );
  });
  return (
    <li className="nv-plate ct-card">
      <div className="ct-card__head">
        <span className="ct-card__emoji" aria-hidden="true">
          {CATEGORY_EMOJIS[drop.category]}
        </span>
        <span className="ct-card__name">{DROP_CATEGORY_LABELS[drop.category]}</span>
        <span className={`ct-state ct-state--${tone}`}>{STATE_WORDS[drop.state]}</span>
      </div>
      <p className="ct-card__meta nv-num">
        {when} · {drop.files.length === 0 ? 'Rien d’ajouté encore' : contentsOf(drop.files)}
      </p>
      {drop.state === 'blocked' && drop.blockedReason !== null ? (
        <p className="ct-card__blocked">{drop.blockedReason}</p>
      ) : null}
      {drop.sentence === null ? null : <p className="ct-card__why">« {drop.sentence} »</p>}
      {drop.state === 'uploading' || drop.state === 'received' ? (
        <ul className="ct-files">
          {drop.files.map((file) => (
            <FileLine key={file.id} drop={drop} file={file} live={sends.get(file.id)} onSettled={onSettled} />
          ))}
        </ul>
      ) : refused.length > 0 ? (
        // Ready or blocked, each refused file keeps its line and its reason: she knows what to shoot again and why,
        // never only « Aucun fichier n'a pu être gardé » (recette MED-03).
        <ul className="ct-files">
          {refused.map((file) => (
            <FileLine key={file.id} drop={drop} file={file} live={undefined} onSettled={onSettled} />
          ))}
        </ul>
      ) : null}
      {drop.state === 'filling' && !confirming ? (
        <div className="ct-card__foot">
          {sending ? null : (
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
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              onOpenScript(drop.id);
            }}
          >
            Continuer
          </button>
        </div>
      ) : mayWithdrawHere(drop) && !sending ? (
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

/** A file's line: its progress while it goes up here, « Reprendre » when its send was cut (the same file again). */
function FileLine({
  drop,
  file,
  live,
  onSettled,
}: {
  drop: ContentDrop;
  file: ContentDropFile;
  live: LiveSend | undefined;
  onSettled: () => void;
}): JSX.Element {
  const picker = useRef<HTMLInputElement>(null);
  const [wrong, setWrong] = useState(false);
  const line = fileLine(file, live);
  const percent =
    live === undefined || live.total === 0 ? 0 : Math.min(100, Math.floor((100 * live.sent) / live.total));
  const showsBar =
    file.state === 'awaiting' && live !== undefined && (live.phase === 'sending' || live.phase === 'waiting');
  const interrupted = file.state === 'awaiting' && (live === undefined || live.phase === 'failed');
  const label = `${file.kind === 'image' ? 'Photo' : file.kind === 'video' ? 'Vidéo' : 'Vocal'} ${String(file.position + 1)}`;
  return (
    <li className="ct-file">
      <div className="ct-file__row">
        <span className="ct-file__name">{label}</span>
        <span
          className={
            file.state === 'refused' || interrupted
              ? 'ct-file__line ct-file__line--warn'
              : 'ct-file__line nv-num'
          }
        >
          {line}
        </span>
        {interrupted ? (
          <>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                picker.current?.click();
              }}
            >
              Reprendre
            </button>
            <input
              ref={picker}
              type="file"
              hidden
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = '';
                if (chosen === undefined) return;
                // The same file, picked again: its weight says so (the server checks its bytes anyway).
                if (chosen.size !== file.bytes) {
                  setWrong(true);
                  return;
                }
                setWrong(false);
                void queueSend(drop.id, file.id, chosen, onSettled);
              }}
            />
          </>
        ) : null}
      </div>
      {showsBar ? (
        <div
          className={live.phase === 'waiting' ? 'nv-gauge nv-gauge--amber' : 'nv-gauge'}
          role="progressbar"
          aria-label={`Envoi de ${label}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="nv-gauge__fill" style={{ '--nv-gauge-value': `${String(percent)}%` }} />
        </div>
      ) : null}
      {wrong ? <p className="ct-file__hint">Ce n’est pas le même fichier : choisis celui du dépôt.</p> : null}
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
            className="nv-field__control"
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
