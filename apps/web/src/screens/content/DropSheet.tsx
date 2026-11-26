import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  DROP_CATEGORY_LABELS,
  declaredFileRefusal,
  dropCountRefusal,
  kindOfMime,
  type ContentDrop,
  type ContentDropFileId,
  type ContentRequest,
  type DropCategory,
  type DropMime,
  type ReadyVideoId,
} from '@impera/contracts';
import { useRef, useState, type JSX } from 'react';

import { Thumb } from './Thumb';
import { Refused, createDrop, useReadyVideoTypes } from './api';
import { durationOf } from './media-length';
import {
  CATEGORY_EMOJIS,
  CATEGORY_HINTS,
  HEAVY_BYTES,
  UNKNOWN_TYPE,
  acceptOf,
  mediaLabel,
  mimeOf,
  moved,
  pickedHeadRefusal,
  sameFile,
  weightOf,
} from './model';

import { Dialog } from '@/shell/Dialog';

/** A file she chose, with the type it goes up as and why it would not go, if it would not. */
interface Chosen {
  readonly id: ContentDropFileId;
  readonly file: File;
  readonly mime: DropMime | null;
  readonly refusal: string | null;
  /** A video's or a vocal's length, once her phone has read it; `null` before, or when it cannot. */
  readonly ms: number | null;
  /** Its first bytes read (recette CRE-12), or no need to: « Envoyer » waits for every file's. */
  readonly checked: boolean;
}

const chosenOf = (category: DropCategory, file: File): Chosen => {
  const mime = mimeOf(file);
  const refusal = mime === null ? UNKNOWN_TYPE : declaredFileRefusal(category, { mime, bytes: file.size });
  return {
    id: ContentDropFileIdSchema.parse(crypto.randomUUID()),
    file,
    mime,
    refusal,
    ms: null,
    checked: refusal !== null,
  };
};

/**
 * The drop sheet (ADR 0055 § 8): three gestures, the category (already chosen), the files from her gallery, a sentence
 * if she wants. Each file is checked before anything goes (relecture Extension): its type, its weight, how many, and
 * that its first bytes are what its type says (recette CRE-12: a text renamed `.jpg` is refused here, never sent).
 */
export function DropSheet({
  category,
  request,
  onClose,
  onDropped,
}: {
  category: DropCategory;
  request: ContentRequest | null;
  onClose: () => void;
  onDropped: (drop: ContentDrop, files: ReadonlyMap<ContentDropFileId, File>) => void;
}): JSX.Element {
  const picker = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<readonly Chosen[]>([]);
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The drop's id is drawn once: a tap replayed after a cut answers the same drop.
  const [dropId] = useState(() => ContentDropIdSchema.parse(crypto.randomUUID()));
  // A video to sell carries its type, chosen among the owner's lines: the AI prices it in that line's range.
  const typed = category === 'sale_video';
  const readyTypes = useReadyVideoTypes(typed);
  const [readyVideoId, setReadyVideoId] = useState<ReadyVideoId | null>(null);
  // No type to give (none yet, or not read): nothing to pick, so no gallery to open.
  const untypable = typed && (readyTypes.data?.types.length ?? 0) === 0;

  const countRefusal = chosen.length === 0 ? null : dropCountRefusal(category, chosen.length);
  const total = chosen.reduce((sum, item) => sum + item.file.size, 0);
  const refused = chosen.filter((item) => item.refusal !== null).length;
  const ready =
    chosen.length > 0 &&
    countRefusal === null &&
    refused === 0 &&
    chosen.every((item) => item.checked) &&
    (!typed || readyVideoId !== null);

  /** Her files added to the list, each video's and vocal's length read after, to say « Vidéo · 8 s ». */
  const add = (picked: readonly File[]): void => {
    const fresh = picked
      .filter((file) => !chosen.some((item) => sameFile(item.file, file)))
      .map((file) => chosenOf(category, file));
    setChosen((list) => [
      ...list,
      ...fresh.filter((item) => !list.some((one) => sameFile(one.file, item.file))),
    ]);
    for (const item of fresh) {
      if (!item.checked && item.mime !== null) {
        void pickedHeadRefusal(item.file, item.mime).then((refusal) => {
          setChosen((list) =>
            list.map((one) =>
              one.id === item.id ? { ...one, refusal: refusal ?? one.refusal, checked: true } : one,
            ),
          );
        });
      }
      const kind = item.mime === null ? null : kindOfMime(item.mime);
      if (kind !== 'video' && kind !== 'audio') continue;
      void durationOf(item.file, kind).then((ms) => {
        setChosen((list) => list.map((one) => (one.id === item.id ? { ...one, ms } : one)));
      });
    }
  };

  const send = (): void => {
    const files = chosen.flatMap((item) =>
      item.mime === null ? [] : [{ id: item.id, mime: item.mime, bytes: item.file.size }],
    );
    const said = sentence.trim();
    setBusy(true);
    setFailed(null);
    createDrop({
      id: dropId,
      category,
      sentence: said === '' ? null : said,
      requestId: request?.id ?? null,
      readyVideoId: typed ? readyVideoId : null,
      files,
    })
      .then((drop) => {
        onDropped(drop, new Map(chosen.map((item) => [item.id, item.file])));
      })
      .catch((error: unknown) => {
        if (error instanceof Refused && error.sentences.length > 0) {
          const byFile = new Map(error.sentences.map((s) => [s.fileId, s.sentence]));
          setChosen((list) =>
            list.map((item) => ({ ...item, refusal: byFile.get(item.id) ?? item.refusal })),
          );
          setFailed(byFile.get(null) ?? null);
        } else {
          setFailed('Ce n’est pas parti : vérifie ta connexion et réessaie.');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Dialog
      title={`${CATEGORY_EMOJIS[category]} ${DROP_CATEGORY_LABELS[category]}`}
      lead={request === null ? CATEGORY_HINTS[category] : request.reason}
      busy={busy}
      className="ct-sheet"
      onClose={onClose}
    >
      <div className="ct-form">
        {typed ? (
          <div className="nv-field">
            <span className="nv-field__label" id={`${dropId}-type`}>
              Quel type de vidéo ?
            </span>
            {readyTypes.isPending ? (
              <p className="ct-note">Un instant…</p>
            ) : readyTypes.isError ? (
              <div className="nv-note nv-note--warn">
                <p className="nv-note__title">Les types ne se chargent pas</p>
                <p className="ct-note">Vérifie ta connexion, puis réessaie.</p>
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--sm ct-retry"
                  onClick={() => {
                    void readyTypes.refetch();
                  }}
                >
                  Réessayer
                </button>
              </div>
            ) : readyTypes.data.types.length === 0 ? (
              <p className="nv-note">
                L’agence n’a pas encore créé de types de vidéo : tu pourras déposer dès qu’elle l’aura fait.
              </p>
            ) : (
              <div className="ct-types" role="radiogroup" aria-labelledby={`${dropId}-type`}>
                {readyTypes.data.types.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    role="radio"
                    className="nv-chip"
                    aria-checked={readyVideoId === one.id}
                    disabled={busy}
                    onClick={() => {
                      setReadyVideoId(one.id);
                    }}
                  >
                    {one.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept={acceptOf(category)}
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])];
            event.target.value = '';
            add(picked);
          }}
        />
        {untypable ? null : (
          <button
            type="button"
            className={chosen.length === 0 ? 'nv-btn nv-btn--neon ct-pick' : 'nv-btn nv-btn--soft ct-pick'}
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            {chosen.length === 0 ? 'Choisir dans ma galerie' : 'Ajouter des fichiers'}
          </button>
        )}

        {chosen.length === 0 ? null : (
          <ul className="ct-chosen">
            {chosen.map((item, index) => {
              const kind = item.mime === null ? null : kindOfMime(item.mime);
              const label = mediaLabel(kind, item.ms);
              const named = `${label.split(' · ')[0] ?? label} ${String(index + 1)}`;
              return (
                <li key={item.id} className="ct-chosen__item">
                  <span className="ct-chosen__visual">
                    <Thumb file={item.file} kind={kind} />
                    <span className="ct-chosen__rank nv-num" aria-hidden="true">
                      {index + 1}
                    </span>
                  </span>
                  <div className="ct-chosen__text">
                    <span className="ct-chosen__name nv-num">{label}</span>
                    <span
                      className={
                        item.refusal === null
                          ? 'ct-chosen__sub nv-num'
                          : 'ct-chosen__sub ct-chosen__sub--warn'
                      }
                    >
                      {item.refusal ?? weightOf(item.file.size)}
                      {/* Its name only where there is room for it (a computer); on a phone it is noise. */}
                      {item.refusal === null ? (
                        <span className="ct-chosen__file"> · {item.file.name}</span>
                      ) : null}
                    </span>
                  </div>
                  {chosen.length > 1 ? (
                    <span className="ct-chosen__move">
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm"
                        aria-label={`Monter ${named}`}
                        disabled={busy || index === 0}
                        onClick={() => {
                          setChosen((list) => moved(list, index, -1));
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm"
                        aria-label={`Descendre ${named}`}
                        disabled={busy || index === chosen.length - 1}
                        onClick={() => {
                          setChosen((list) => moved(list, index, 1));
                        }}
                      >
                        ↓
                      </button>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain nv-btn--sm"
                    aria-label={`Enlever ${named}`}
                    disabled={busy}
                    onClick={() => {
                      setChosen((list) => list.filter((other) => other.id !== item.id));
                    }}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {countRefusal === null ? null : <p className="ct-warn">{countRefusal}</p>}
        {total > HEAVY_BYTES ? (
          <p className="ct-note">
            {weightOf(total)} à envoyer : garde l’écran allumé, en Wi-Fi si tu peux. Si le réseau coupe, ça
            reprend tout seul ; si la page se ferme, touche « Reprendre » sur le dépôt.
          </p>
        ) : null}

        {untypable ? null : (
          <label className="nv-field">
            <span className="nv-field__label">Un mot sur ce que tu as fait (facultatif)</span>
            <input
              className="nv-field__control"
              maxLength={200}
              value={sentence}
              disabled={busy}
              onChange={(event) => {
                setSentence(event.target.value);
              }}
            />
          </label>
        )}

        {failed === null ? null : (
          <p className="ct-warn" role="alert">
            {failed}
          </p>
        )}
        <div className="ct-form__actions">
          {/* No type to give: nothing to send, one way out (relecture Design, 26/11). */}
          {untypable && !readyTypes.isPending ? (
            <button type="button" className="nv-btn nv-btn--soft" onClick={onClose}>
              Fermer
            </button>
          ) : (
            <>
              <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
                Annuler
              </button>
              <button type="button" className="nv-btn nv-btn--neon" disabled={!ready || busy} onClick={send}>
                {busy ? 'Un instant…' : 'Envoyer'}
              </button>
            </>
          )}
        </div>
        {/* Why « Envoyer » stays grey, beside it: the refused line may be out of sight in a long list (CRE-16). */}
        {typed && readyVideoId === null && chosen.length > 0 && refused === 0 ? (
          <p className="ct-warn ct-form__why">Choisis le type de la vidéo pour envoyer.</p>
        ) : null}
        {refused === 0 ? null : (
          <p className="ct-warn ct-form__why">
            {refused === 1
              ? 'Retire le fichier refusé pour envoyer.'
              : `Retire les ${String(refused)} fichiers refusés pour envoyer.`}
          </p>
        )}
      </div>
    </Dialog>
  );
}
