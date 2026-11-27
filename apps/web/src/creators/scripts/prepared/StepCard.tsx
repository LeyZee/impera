import {
  PREPARED_AFTER_MEDIA_MAX,
  PREPARED_STEP_BRANCHES_MAX,
  PREPARED_STEP_RHYTHM_MAX,
  PLATFORM_SCRIPT_STEP_TEXT_MAX,
  type CreatorId,
  type PreparedBranch,
  type PreparedScriptContent,
  type PreparedScriptGap,
  type PreparedStep,
} from '@impera/contracts';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { sellable, type EditorMedia } from './media';
import { conditionLabel, parsePrice, priceLabel, priceText, stepKind } from './model';
import { ChevronIcon, MediaTile, RemoveButton } from './parts';

/** What a step card asks of the editor: every change goes up as a new content, saved by the editor. */
export interface StepActions {
  readonly onBranch: (key: string, change: (branch: PreparedBranch) => PreparedBranch) => void;
  readonly onRhythm: (rhythm: number) => void;
  readonly onAddBranch: () => void;
  readonly onRemoveBranch: (key: string) => void;
  /** A branch's price as typed is not a price (refused) or is one again: the editor says it is not saved (PRO1-08). */
  readonly onPriceRefused: (key: string, refused: boolean) => void;
  readonly onPickMedia: (key: string) => void;
  readonly onCondition: (key: string) => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}

/** One step: its head (number, kind, prices), and open, its branches side by side (tabs on a phone). */
export function StepCard({
  creatorId,
  content,
  step,
  index,
  open,
  gaps,
  media,
  actions,
  onToggle,
}: {
  creatorId: CreatorId;
  content: PreparedScriptContent;
  step: PreparedStep;
  index: number;
  open: boolean;
  /** The server's gaps on this step. */
  gaps: readonly PreparedScriptGap[];
  media: ReadonlyMap<string, EditorMedia>;
  actions: StepActions;
  onToggle: () => void;
}): JSX.Element {
  const id = useId();
  const [shown, setShown] = useState(step.branches[0]?.key ?? '');
  const visible = step.branches.some((branch) => branch.key === shown)
    ? shown
    : (step.branches[0]?.key ?? '');
  const multi = step.branches.length > 1;
  const paid = step.branches.filter((branch) => branch.priceMinor > 0);
  const count = step.branches.reduce((sum, branch) => sum + branch.media.length, 0);
  const last = index === content.steps.length - 1;
  const shownBranch = step.branches.find((branch) => branch.key === visible);

  return (
    <section className="nv-plate se-step" data-open={open ? '' : undefined} aria-labelledby={`${id}-title`}>
      <button type="button" className="se-step__head" aria-expanded={open} onClick={onToggle}>
        <span className="se-step__num nv-num" aria-hidden="true">
          {index + 1}
        </span>
        <span className="se-step__title">
          <span className="nv-h3" id={`${id}-title`}>
            Étape {index + 1} <span className="se-pill se-pill--plain">{stepKind(step)}</span>
            {gaps.length > 0 ? <span className="se-pill se-pill--warn">Incomplète</span> : null}
          </span>
          <span className="se-step__sub">
            {step.rhythm > 0 ? `${String(step.rhythm)} messages du fan avant · ` : ''}
            {count === 1 ? '1 média' : `${String(count)} médias`}
          </span>
        </span>
        <span className="se-step__right">
          {paid.length > 0 ? (
            <span className="se-prices nv-num">
              {[...new Set(paid.map((branch) => branch.priceMinor))]
                .sort((a, b) => a - b)
                .map((minor) => priceLabel(minor))
                .join(' · ')}
            </span>
          ) : null}
          <span className="se-chev">
            <ChevronIcon />
          </span>
        </span>
      </button>
      {open ? (
        <div className="se-step__pad">
          {multi ? (
            <>
              <div
                className="se-branch-tabs"
                role="tablist"
                aria-label={`Branches de l’étape ${String(index + 1)}`}
              >
                {step.branches.map((branch, at) => (
                  <button
                    key={branch.key}
                    type="button"
                    role="tab"
                    className="se-branch-tab"
                    aria-selected={branch.key === visible}
                    onClick={() => {
                      setShown(branch.key);
                    }}
                  >
                    {String(at + 1)} · {conditionLabel(branch.condition, content).kind}
                  </button>
                ))}
              </div>
              {shownBranch === undefined ? null : (
                <span className="se-cond-full">{conditionLabel(shownBranch.condition, content).text}</span>
              )}
            </>
          ) : null}
          <div className="se-branches" style={{ '--n': step.branches.length }}>
            {step.branches.map((branch, at) => (
              <BranchCard
                key={branch.key}
                creatorId={creatorId}
                content={content}
                stepIndex={index}
                branch={branch}
                order={at}
                count={step.branches.length}
                shown={branch.key === visible}
                incomplete={gaps.some((gap) => gap.branch === branch.key)}
                media={media}
                actions={actions}
              />
            ))}
          </div>
          <div className="se-foot">
            <span className="se-kv" role="group" aria-labelledby={`${id}-rhythm`}>
              <span id={`${id}-rhythm`}>Rythme</span>
              <span className="se-stepper">
                <button
                  type="button"
                  className="se-stepper__btn"
                  aria-label="Un message de moins"
                  disabled={step.rhythm === 0}
                  onClick={() => {
                    actions.onRhythm(step.rhythm - 1);
                  }}
                >
                  −
                </button>
                <b className="nv-num" aria-live="polite">
                  {step.rhythm}
                </b>
                <button
                  type="button"
                  className="se-stepper__btn"
                  aria-label="Un message de plus"
                  disabled={step.rhythm >= PREPARED_STEP_RHYTHM_MAX}
                  onClick={() => {
                    actions.onRhythm(step.rhythm + 1);
                  }}
                >
                  +
                </button>
              </span>
              <span>messages du fan avant cette étape</span>
            </span>
            <span className="se-foot__btns">
              {step.branches.length < PREPARED_STEP_BRANCHES_MAX ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm se-flush"
                  onClick={actions.onAddBranch}
                >
                  ＋ Ajouter une branche
                </button>
              ) : null}
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={index === 0}
                onClick={() => {
                  actions.onMove(-1);
                }}
              >
                Monter
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={last}
                onClick={() => {
                  actions.onMove(1);
                }}
              >
                Descendre
              </button>
              {content.steps.length > 1 ? (
                <RemoveButton label="Retirer l’étape" onConfirm={actions.onRemove} />
              ) : null}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor: string;
}): JSX.Element {
  return (
    <label className="se-field" htmlFor={htmlFor}>
      <span className="se-field__label">
        {label}
        {hint === undefined ? null : <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}

const AFTER: readonly (readonly ['justAfter' | 'unread' | 'readNotBought', string])[] = [
  ['justAfter', 'Juste après'],
  ['unread', 'Pas lu'],
  ['readNotBought', 'Lu, pas acheté'],
];

function BranchCard({
  creatorId,
  content,
  stepIndex,
  branch,
  order,
  count,
  shown,
  incomplete,
  media,
  actions,
}: {
  creatorId: CreatorId;
  content: PreparedScriptContent;
  stepIndex: number;
  branch: PreparedBranch;
  order: number;
  count: number;
  shown: boolean;
  incomplete: boolean;
  media: ReadonlyMap<string, EditorMedia>;
  actions: StepActions;
}): JSX.Element {
  const id = useId();
  const label = conditionLabel(branch.condition, content);
  // The price as typed, kept while it is not a price yet (« 12, »): the content keeps the last one that was.
  const [price, setPrice] = useState(priceText(branch.priceMinor));
  const refused = parsePrice(price) === null;
  const change = (next: (one: PreparedBranch) => PreparedBranch): void => {
    actions.onBranch(branch.key, next);
  };

  return (
    <article
      className="se-branch"
      data-incomplete={incomplete ? '' : undefined}
      data-shown={shown ? '' : undefined}
      aria-label={count > 1 ? `Branche ${String(order + 1)}` : undefined}
    >
      {count > 1 ? (
        <div className="se-cond">
          <button
            type="button"
            className="se-cond__btn"
            data-unset={branch.condition === null ? '' : undefined}
            onClick={() => {
              actions.onCondition(branch.key);
            }}
          >
            <span className="se-cond__kind">{label.kind}</span>
            <span>{label.text}</span>
          </button>
          <span className="se-order nv-num" title="Ordre entre branches à égalité">
            {order + 1}/{count}
          </span>
        </div>
      ) : null}
      {stepIndex > 0 || branch.teaser !== '' ? (
        <Field label="Teaser avant le média" hint="adapté par la voix" htmlFor={`${id}-teaser`}>
          <textarea
            id={`${id}-teaser`}
            className="se-text"
            rows={2}
            maxLength={PLATFORM_SCRIPT_STEP_TEXT_MAX}
            placeholder="Rien : il ne part pas"
            value={branch.teaser}
            onChange={(event) => {
              const teaser = event.target.value;
              change((one) => ({ ...one, teaser }));
            }}
          />
        </Field>
      ) : null}
      <Field label="Texte d’offre" hint="part mot pour mot" htmlFor={`${id}-offer`}>
        <textarea
          id={`${id}-offer`}
          className="se-text"
          rows={2}
          maxLength={PLATFORM_SCRIPT_STEP_TEXT_MAX}
          value={branch.offerText}
          onChange={(event) => {
            const offerText = event.target.value;
            change((one) => ({ ...one, offerText }));
          }}
        />
      </Field>
      <div className="se-field">
        <span className="se-field__label">
          Médias{branch.media.length > 0 ? <em>{branch.media.length}</em> : null}
        </span>
        <div className="se-media">
          {branch.media.map((one) => {
            const item = media.get(one.ref) ?? null;
            return (
              <span key={one.ref} className="se-media__one">
                <MediaTile
                  creatorId={creatorId}
                  item={item}
                  mediaRef={one.ref}
                  flagged={item === null || !sellable(item)}
                />
                <button
                  type="button"
                  className="se-media__remove"
                  aria-label="Retirer ce média"
                  onClick={() => {
                    change((was) => ({ ...was, media: was.media.filter((kept) => kept.ref !== one.ref) }));
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
          <button
            type="button"
            className="se-tile--add"
            aria-label="Choisir des médias"
            onClick={() => {
              actions.onPickMedia(branch.key);
            }}
          >
            ＋
          </button>
        </div>
      </div>
      {branch.priceMinor > 0 ? (
        <div className="se-field">
          <span className="se-field__label">
            Messages après le média<em>une seule relance</em>
          </span>
          <div className="se-after">
            {AFTER.map(([key, when]) => (
              <label key={key} className="se-trig" htmlFor={`${id}-${key}`}>
                <span className="se-trig__when">{when}</span>
                <textarea
                  id={`${id}-${key}`}
                  className="se-text"
                  rows={1}
                  maxLength={PREPARED_AFTER_MEDIA_MAX}
                  placeholder="Rien"
                  value={branch.afterMedia[key]}
                  onChange={(event) => {
                    const text = event.target.value;
                    change((one) => ({ ...one, afterMedia: { ...one.afterMedia, [key]: text } }));
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      ) : (
        <Field label="Message après le média" htmlFor={`${id}-justAfter`}>
          <textarea
            id={`${id}-justAfter`}
            className="se-text"
            rows={1}
            maxLength={PREPARED_AFTER_MEDIA_MAX}
            placeholder="Rien"
            value={branch.afterMedia.justAfter}
            onChange={(event) => {
              const justAfter = event.target.value;
              change((one) => ({ ...one, afterMedia: { ...one.afterMedia, justAfter } }));
            }}
          />
        </Field>
      )}
      <div className="se-foot">
        <label className="se-kv se-kv--price" htmlFor={`${id}-price`}>
          <span>Prix TTC</span>
          <input
            id={`${id}-price`}
            className="se-text se-text--price nv-num"
            inputMode="decimal"
            placeholder="Offert"
            value={price}
            aria-invalid={refused ? 'true' : undefined}
            aria-describedby={refused ? `${id}-price-hint` : undefined}
            onChange={(event) => {
              const text = event.target.value;
              setPrice(text);
              const minor = parsePrice(text);
              actions.onPriceRefused(branch.key, minor === null);
              if (minor !== null) change((one) => ({ ...one, priceMinor: minor }));
            }}
          />
          <span>€</span>
        </label>
        {refused ? (
          <p id={`${id}-price-hint`} className="se-price-hint" role="alert">
            Un prix comme 12 ou 12,50
          </p>
        ) : null}
        {count > 1 ? (
          <RemoveButton
            label="Retirer la branche"
            onConfirm={() => {
              actions.onRemoveBranch(branch.key);
            }}
          />
        ) : null}
      </div>
    </article>
  );
}
