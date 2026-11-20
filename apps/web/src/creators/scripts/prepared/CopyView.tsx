import type { CreatorId, PreparedScriptView } from '@impera/contracts';
import { useState, type JSX } from 'react';

import type { EditorMedia } from './media';
import { conditionLabel, differenceText, priceLabel, priceText } from './model';
import { MediaTile } from './parts';

import { ScriptArt } from '@/shell/art/EmptyArt';
import { Empty } from '@/shell/states';

/**
 * « À copier dans Reveal » (ADR 0112 § 21): each script « prêt à copier », step by step, what to type into Reveal and
 * a button to copy each text. Impera writes nothing at Reveal: a person copies, and the next import recognises it. What
 * still differs from Reveal is said under the script, from the server's reading.
 */
export function CopyView({
  creatorId,
  scripts,
  media,
  onOpen,
}: {
  creatorId: CreatorId;
  scripts: readonly PreparedScriptView[];
  media: ReadonlyMap<string, EditorMedia>;
  onOpen: (view: PreparedScriptView) => void;
}): JSX.Element {
  const ready = scripts.filter((view) => view.state === 'ready_to_copy');
  if (ready.length === 0)
    return (
      <Empty plate art={<ScriptArt />} title="Rien à recopier">
        Un script passe ici quand rien ne lui manque et que tu le dis « Prêt à copier dans Reveal ».
      </Empty>
    );
  return (
    <div className="se-copy-list">
      {ready.map((view) => (
        <CopyScript key={view.id} creatorId={creatorId} view={view} media={media} onOpen={onOpen} />
      ))}
    </div>
  );
}

function CopyScript({
  creatorId,
  view,
  media,
  onOpen,
}: {
  creatorId: CreatorId;
  view: PreparedScriptView;
  media: ReadonlyMap<string, EditorMedia>;
  onOpen: (view: PreparedScriptView) => void;
}): JSX.Element {
  const [copied, setCopied] = useState<ReadonlySet<string>>(new Set());
  const rows = view.content.steps.flatMap((step, index) =>
    step.branches.map((branch, order) => ({ step, index, branch, order })),
  );
  const total = rows.length * 2 + 1;

  const copy = (key: string, text: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied((before) => new Set([...before, key]));
      },
      () => undefined,
    );
  };
  const button = (key: string, text: string): JSX.Element => (
    <button
      type="button"
      className={`nv-btn nv-btn--soft nv-btn--sm${copied.has(key) ? ' se-copied' : ''}`}
      onClick={() => {
        copy(key, text);
      }}
    >
      {copied.has(key) ? '✓ Copié' : 'Copier'}
    </button>
  );

  return (
    <section className="se-copy" aria-label={view.content.name}>
      <div className="nv-plate nv-plate--pad se-copy__intro">
        <div className="se-copy__top">
          <div>
            <p className="nv-eyebrow">Prêt à copier</p>
            <h2 className="nv-h2">{view.content.name}</h2>
          </div>
          <span className="se-note nv-num">
            {String(copied.size)} / {String(total)} copiés
          </span>
        </div>
        <div className="se-progress" aria-hidden="true">
          <i style={{ width: `${String((100 * copied.size) / total)}%` }} />
        </div>
        <p className="se-note">
          Dans Reveal, crée un script au même nom, puis chaque étape dans cet ordre, avec ses médias et son
          prix. Les branches d’une même étape vont au même rang. Quand l’import suivant le lit, Impera le
          reconnaît et y rattache l’ordre et les conditions de ses branches.
        </p>
        <div className="se-copy__row">
          <span className="se-copy__k">Nom</span>
          <span className="se-copy__v">{view.content.name}</span>
          {button('name', view.content.name)}
        </div>
        {view.copyDifferences !== null && view.copyDifferences.length > 0 ? (
          <ul className="se-warns" aria-label="Ce qui diffère encore dans Reveal">
            {view.copyDifferences.map((difference, at) => (
              <li key={`${difference.code}-${String(at)}`} className="se-warn">
                {differenceText(view.content, difference)}
              </li>
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm se-flush se-copy__edit"
          onClick={() => {
            onOpen(view);
          }}
        >
          Ouvrir le script
        </button>
      </div>
      {rows.map(({ step, index, branch, order }) => {
        const multi = step.branches.length > 1;
        const key = branch.key;
        return (
          <section key={key} className="nv-plate nv-plate--pad se-copy__step">
            <div className="se-copy__head">
              <span className="se-step__num nv-num" aria-hidden="true">
                {index + 1}
              </span>
              <h3 className="nv-h3">
                Étape {index + 1}
                {multi ? ` · branche ${String(order + 1)}` : ''}
              </h3>
              {multi ? (
                <span className="se-pill se-pill--plain">
                  {conditionLabel(branch.condition, view.content).kind}
                </span>
              ) : null}
            </div>
            <div className="se-copy__row">
              <span className="se-copy__k">Texte d’offre</span>
              <span className="se-copy__v">{branch.offerText}</span>
              {button(`${key}:offer`, branch.offerText)}
            </div>
            <div className="se-copy__row">
              <span className="se-copy__k">Médias, dans l’ordre</span>
              <span className="se-copy__v">
                <span className="se-media">
                  {branch.media.map((one) => (
                    <MediaTile
                      key={one.ref}
                      creatorId={creatorId}
                      item={media.get(one.ref) ?? null}
                      mediaRef={one.ref}
                      flagged={false}
                    />
                  ))}
                </span>
              </span>
              <span />
            </div>
            <div className="se-copy__row">
              <span className="se-copy__k">Prix</span>
              <span className="se-copy__v">
                <b className="nv-num">{priceLabel(branch.priceMinor)}</b>
              </span>
              {button(`${key}:price`, priceText(branch.priceMinor) || '0')}
            </div>
          </section>
        );
      })}
    </section>
  );
}
