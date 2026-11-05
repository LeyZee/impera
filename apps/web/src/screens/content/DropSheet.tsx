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
} from '@impera/contracts';
import { useRef, useState, type JSX } from 'react';

import { Thumb } from './Thumb';
import { Refused, createDrop } from './api';
import {
  CATEGORY_EMOJIS,
  CATEGORY_HINTS,
  HEAVY_BYTES,
  UNKNOWN_TYPE,
  acceptOf,
  mimeOf,
  moved,
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
}

const chosenOf = (category: DropCategory, file: File): Chosen => {
  const mime = mimeOf(file);
  return {
    id: ContentDropFileIdSchema.parse(crypto.randomUUID()),
    file,
    mime,
    refusal: mime === null ? UNKNOWN_TYPE : declaredFileRefusal(category, { mime, bytes: file.size }),
  };
};

/**
 * The drop sheet (ADR 0055 § 8): three gestures, the category (already chosen), the files from her gallery, a sentence
 * if she wants. Each file is checked before anything goes (relecture Extension): its type, its weight, how many.
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

  const countRefusal = chosen.length === 0 ? null : dropCountRefusal(category, chosen.length);
  const total = chosen.reduce((sum, item) => sum + item.file.size, 0);
  const ready = chosen.length > 0 && countRefusal === null && chosen.every((item) => item.refusal === null);

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
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept={acceptOf(category)}
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])];
            event.target.value = '';
            setChosen((list) => [
              ...list,
              ...picked
                .filter((file) => !list.some((item) => sameFile(item.file, file)))
                .map((file) => chosenOf(category, file)),
            ]);
          }}
        />
        <button
          type="button"
          className={chosen.length === 0 ? 'nv-btn nv-btn--neon ct-pick' : 'nv-btn nv-btn--soft ct-pick'}
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          {chosen.length === 0 ? 'Choisir dans ma galerie' : 'Ajouter des fichiers'}
        </button>

        {chosen.length === 0 ? null : (
          <ul className="ct-chosen">
            {chosen.map((item, index) => (
              <li key={item.id} className="ct-chosen__item">
                <span className="ct-chosen__visual">
                  <Thumb file={item.file} kind={item.mime === null ? null : kindOfMime(item.mime)} />
                  <span className="ct-chosen__rank nv-num" aria-hidden="true">
                    {index + 1}
                  </span>
                </span>
                <div className="ct-chosen__text">
                  <span className="ct-chosen__name">{item.file.name}</span>
                  <span
                    className={
                      item.refusal === null ? 'ct-chosen__sub nv-num' : 'ct-chosen__sub ct-chosen__sub--warn'
                    }
                  >
                    {item.refusal ?? weightOf(item.file.size)}
                  </span>
                </div>
                {chosen.length > 1 ? (
                  <span className="ct-chosen__move">
                    <button
                      type="button"
                      className="nv-btn nv-btn--plain nv-btn--sm"
                      aria-label={`Monter ${item.file.name}`}
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
                      aria-label={`Descendre ${item.file.name}`}
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
                  aria-label={`Enlever ${item.file.name}`}
                  disabled={busy}
                  onClick={() => {
                    setChosen((list) => list.filter((other) => other.id !== item.id));
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {countRefusal === null ? null : <p className="ct-warn">{countRefusal}</p>}
        {total > HEAVY_BYTES ? (
          <p className="ct-note">
            {weightOf(total)} à envoyer : garde l’écran allumé, en Wi-Fi si tu peux. Si le réseau coupe, ça
            reprend tout seul ; si la page se ferme, touche « Reprendre » sur le dépôt.
          </p>
        ) : null}

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

        {failed === null ? null : (
          <p className="ct-warn" role="alert">
            {failed}
          </p>
        )}
        <div className="ct-form__actions">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="nv-btn nv-btn--neon" disabled={!ready || busy} onClick={send}>
            {busy ? 'Un instant…' : 'Envoyer'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
