import {
  BRANCH_CONDITION_TEXT_MAX,
  PreparedScriptIdSchema,
  type BranchCondition,
  type CreatorId,
  type PlatformAccountId,
  type PlatformScriptMoment,
  type PreparedScriptContent,
  type PreparedScriptView,
} from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import { createPrepared } from './api';
import { sellable, type EditorMedia } from './media';
import { newContent, parsePrice, previousBranches, priceText } from './model';
import { MediaTile, MomentChoice } from './parts';

import { Dialog } from '@/shell/Dialog';

/*
 * The editor's three panels, each the app's own `Dialog`: « Nouveau script », « Choisir des médias » and « Quand prendre
 * cette branche ».
 */

/** « Nouveau script »: its name, its idea and its moment; created empty, in « brouillon ». */
export function NewScriptDialog({
  creatorId,
  creatorName,
  accounts,
  onCreated,
  onClose,
}: {
  creatorId: CreatorId;
  creatorName: string;
  /** Her accounts her vault was read from: the first one, the only one today (Reveal). */
  accounts: readonly PlatformAccountId[];
  onCreated: (view: PreparedScriptView) => void;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [moment, setMoment] = useState<PlatformScriptMoment>('night');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Under one id for the whole panel: a send replayed after a cut answers the same script.
  const [scriptId] = useState(() => PreparedScriptIdSchema.parse(crypto.randomUUID()));
  const account = accounts[0];

  const create = async (): Promise<void> => {
    if (account === undefined) return;
    setBusy(true);
    setError(null);
    const outcome = await createPrepared(creatorId, scriptId, account, newContent(name, idea, moment));
    setBusy(false);
    if (outcome.kind === 'ok') onCreated(outcome.view);
    else setError(outcome.message);
  };

  return (
    <Dialog title="Nouveau script" lead={creatorName} busy={busy} className="se-dialog" onClose={onClose}>
      <div className="se-dialog__body">
        <label className="se-field" htmlFor={`${id}-name`}>
          <span className="se-field__label">Nom</span>
          <input
            id={`${id}-name`}
            className="se-text"
            data-autofocus
            value={name}
            maxLength={200}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <label className="se-field" htmlFor={`${id}-idea`}>
          <span className="se-field__label">
            L’idée du script<em>thème, situation, envie servie</em>
          </span>
          <textarea
            id={`${id}-idea`}
            className="se-text"
            rows={3}
            value={idea}
            maxLength={2000}
            onChange={(event) => {
              setIdea(event.target.value);
            }}
          />
        </label>
        <MomentChoice value={moment} onChange={setMoment} />
        {account === undefined ? (
          <p className="se-note" role="status">
            Son coffre n’a pas encore été lu : synchronise-le dans Médias, puis reviens créer le script.
          </p>
        ) : null}
        {error === null ? null : (
          <p className="se-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="se-dialog__foot">
        <span className="se-note">
          Créé en brouillon : rien ne part tant qu’il n’est pas recopié dans Reveal.
        </span>
        <button
          type="button"
          className="nv-btn nv-btn--neon"
          disabled={busy || account === undefined}
          onClick={() => void create()}
        >
          Créer le brouillon
        </button>
      </div>
    </Dialog>
  );
}

/** « Choisir des médias »: her vault folder by folder; only a media imported and described can be ticked. */
export function MediaPicker({
  creatorId,
  place,
  folders,
  media,
  taken,
  onAdd,
  onClose,
}: {
  creatorId: CreatorId;
  /** Where the media go, said above the title: « Étape 2, branche 1 ». */
  place: string;
  folders: readonly { readonly key: string; readonly name: string }[];
  media: ReadonlyMap<string, EditorMedia>;
  /** Already in the branch: shown ticked, never added twice. */
  taken: readonly string[];
  onAdd: (refs: readonly string[]) => void;
  onClose: () => void;
}): JSX.Element {
  const [folder, setFolder] = useState(folders[0]?.key ?? '');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const shown = [...media.entries()].filter(([, item]) => item.folderKey === folder && !item.media.removed);

  const toggle = (ref: string): void => {
    setPicked((before) => {
      const next = new Set(before);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  return (
    <Dialog title="Choisir des médias" lead={place} className="se-dialog se-dialog--wide" onClose={onClose}>
      <div className="se-dialog__body">
        <p className="se-note">
          Seuls les médias importés et décrits entrent dans un script : l’IA sait ce qu’elle vend sans voir
          l’image.
        </p>
        <div className="se-folders" role="radiogroup" aria-label="Ses dossiers">
          {folders.map((one) => (
            <button
              key={one.key}
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={one.key === folder}
              onClick={() => {
                setFolder(one.key);
              }}
            >
              {one.name}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="se-note">Aucun média dans ce dossier.</p>
        ) : (
          <div className="se-grid">
            {shown.map(([ref, item]) => {
              const ok = sellable(item);
              const already = taken.includes(ref);
              const on = already || picked.has(ref);
              const why = !item.imported
                ? 'Pas importé : à cocher dans Médias'
                : !item.described
                  ? 'Pas décrit : à décrire dans Médias'
                  : item.media.kind === 'audio'
                    ? 'Une note vocale ne se vend pas dans un script'
                    : (item.excerpt ?? '');
              return (
                <div key={ref} className="se-pick" data-disabled={ok && !already ? undefined : ''}>
                  <span className="se-pick__media">
                    <MediaTile creatorId={creatorId} item={item} mediaRef={ref} flagged={false} />
                    {ok ? (
                      <input
                        type="checkbox"
                        className="nv-check se-pick__check"
                        aria-label={item.excerpt ?? 'Ce média'}
                        checked={on}
                        disabled={already}
                        onChange={() => {
                          toggle(ref);
                        }}
                      />
                    ) : null}
                  </span>
                  <span className="se-pick__ex">{already ? 'Déjà dans cette branche' : why}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="se-dialog__foot">
        <span className="se-note nv-num">
          {picked.size === 0
            ? 'Aucun média choisi'
            : `${String(picked.size)} média${picked.size > 1 ? 's' : ''} choisi${picked.size > 1 ? 's' : ''}`}
        </span>
        <span className="se-dialog__btns">
          <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--neon"
            disabled={picked.size === 0}
            onClick={() => {
              onAdd([...picked]);
            }}
          >
            {picked.size === 0 ? 'Ajouter' : `Ajouter ${String(picked.size)}`}
          </button>
        </span>
      </div>
    </Dialog>
  );
}

type ConditionKind = 'none' | 'spent' | 'previous' | 'text';

const CHOICES: readonly (readonly [ConditionKind, string, string])[] = [
  ['none', 'Par défaut', 'Quand aucune autre branche ne s’applique. Une seule par étape.'],
  [
    'spent',
    'Dépense passée',
    'A déjà dépensé au moins un montant chez elle. Seulement vers une branche plus chère.',
  ],
  ['previous', 'Branche prise avant', 'Suit la branche choisie à une étape d’avant.'],
  [
    'text',
    'Lu par l’IA',
    'Une phrase que l’IA vérifie dans la conversation, par exemple « s’il a dit aimer le rouge ».',
  ],
];

const kindOf = (condition: BranchCondition | null): ConditionKind | null => {
  if (condition === null) return null;
  if (condition.kind === 'none' || condition.kind === 'text') return condition.kind;
  return condition.rule.kind === 'spent_at_least' ? 'spent' : 'previous';
};

/** « Quand prendre cette branche »: a rule of the closed list, or a sentence the AI checks (ADR 0112 § 5). */
export function ConditionDialog({
  content,
  stepIndex,
  condition,
  onSave,
  onClose,
}: {
  content: PreparedScriptContent;
  stepIndex: number;
  condition: BranchCondition | null;
  onSave: (condition: BranchCondition) => void;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const [kind, setKind] = useState<ConditionKind | null>(kindOf(condition));
  const [text, setText] = useState(condition?.kind === 'text' ? condition.text : '');
  const [amount, setAmount] = useState(
    condition?.kind === 'structured' && condition.rule.kind === 'spent_at_least'
      ? priceText(condition.rule.amountMinor)
      : '',
  );
  const earlier = previousBranches(content, stepIndex);
  const [previous, setPrevious] = useState(
    condition?.kind === 'structured' && condition.rule.kind === 'previous_branch'
      ? condition.rule.stepRef
      : (earlier[0]?.key ?? ''),
  );

  const built = ((): BranchCondition | null => {
    if (kind === 'none') return { kind: 'none' };
    if (kind === 'text') return text.trim() === '' ? null : { kind: 'text', text: text.trim() };
    if (kind === 'previous')
      return previous === ''
        ? null
        : { kind: 'structured', rule: { kind: 'previous_branch', stepRef: previous } };
    if (kind === 'spent') {
      const minor = parsePrice(amount);
      return minor === null || minor === 0
        ? null
        : { kind: 'structured', rule: { kind: 'spent_at_least', amountMinor: minor, currency: 'EUR' } };
    }
    return null;
  })();

  return (
    <Dialog
      title="Quand prendre cette branche"
      lead={`Étape ${String(stepIndex + 1)}`}
      className="se-dialog"
      onClose={onClose}
    >
      <div className="se-dialog__body">
        <div className="se-choices" role="radiogroup" aria-label="Condition">
          {CHOICES.map(([value, title, detail]) => {
            const unavailable = value === 'previous' && earlier.length === 0;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                className="se-choice"
                aria-checked={kind === value}
                aria-disabled={unavailable ? 'true' : undefined}
                onClick={() => {
                  if (!unavailable) setKind(value);
                }}
              >
                <span className="se-radio" aria-hidden="true" />
                <b>{title}</b>
                <small>{unavailable ? 'Aucune étape d’avant n’a plusieurs branches.' : detail}</small>
              </button>
            );
          })}
        </div>
        {kind === 'text' ? (
          <label className="se-field" htmlFor={`${id}-text`}>
            <span className="se-field__label">
              La phrase que l’IA vérifie<em>{BRANCH_CONDITION_TEXT_MAX} caractères au plus</em>
            </span>
            <textarea
              id={`${id}-text`}
              className="se-text"
              rows={2}
              maxLength={BRANCH_CONDITION_TEXT_MAX}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </label>
        ) : null}
        {kind === 'spent' ? (
          <label className="se-field" htmlFor={`${id}-amount`}>
            <span className="se-field__label">A déjà dépensé au moins (€)</span>
            <input
              id={`${id}-amount`}
              className="se-text se-text--price nv-num"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />
          </label>
        ) : null}
        {kind === 'previous' ? (
          <div className="se-field">
            <span className="se-field__label">La branche suivie</span>
            <div className="se-folders" role="radiogroup" aria-label="La branche suivie">
              {earlier.map((one) => (
                <button
                  key={one.key}
                  type="button"
                  role="radio"
                  className="nv-chip"
                  aria-checked={previous === one.key}
                  onClick={() => {
                    setPrevious(one.key);
                  }}
                >
                  {one.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="se-dialog__foot">
        <span className="se-note">Une règle vraie passe avant la lecture de l’IA.</span>
        <button
          type="button"
          className="nv-btn nv-btn--neon"
          disabled={built === null}
          onClick={() => {
            if (built !== null) onSave(built);
          }}
        >
          OK
        </button>
      </div>
    </Dialog>
  );
}
