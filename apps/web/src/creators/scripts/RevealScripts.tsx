import {
  SCRIPT_ENERGIES,
  SCRIPT_IDENTITY_CUES_MAX,
  SCRIPT_IDENTITY_TEXT_MAX,
  type CreatorId,
  type MediaDescriptionId,
  type PlatformScriptViewDto,
  type ScriptEnergy,
  type ScriptIdentityContent,
  type VaultMediaView,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState, type JSX } from 'react';

import { MOMENT_EMOJIS } from './model';
import { usePreparedScripts } from './prepared/api';
import {
  ENERGY_LABELS,
  ENERGY_VALUES,
  batchOf,
  mediaToValidate,
  ourCopies,
  placeOf,
  priceLine,
  revealStanding,
  revealSummary,
  type MediaToValidate,
} from './reveal';
import {
  correctScriptDescription,
  correctScriptIdentity,
  revealScriptsKey,
  useRevealScripts,
  validateScriptDescriptions,
  validateScriptIdentity,
  type RevealOutcome,
} from './reveal-api';
import { REASON_LABELS } from './review';

import { useVault } from '@/creators/vault/api';
import { ChevronIcon, Preview, Sharp } from '@/creators/vault/parts';
import { useGrowingArea } from '@/lib/growing-area';
import { useMediaBlur } from '@/shell/media-blur';
import { Failure } from '@/shell/states';

/**
 * « Ses scripts dans Reveal » (ADR 0030 § 3, ADR 0099 § 4, SC-04 lot c8): her Reveal scripts, each with the one thing
 * that keeps it from being offered by the agent, said as the next gesture. A script to review opens on what is to
 * validate, its media's descriptions first, then its identity; the first of them is open already. The owner and the
 * managers of her list only: the server refuses anyone else. Only the copies of scripts prepared in Impera (Charles,
 * 20/11): her other Reveal scripts, those of an earlier tool among them, are never listed, offered or validated here.
 */
export function RevealScripts({ creatorId }: { creatorId: CreatorId }): JSX.Element {
  const natives = useRevealScripts(creatorId);
  const prepared = usePreparedScripts(creatorId);
  const vault = useVault(creatorId, false);
  const [opened, setOpened] = useState<string | null | undefined>(undefined);

  // Her vault's media by the platform's id, for their blurred picture beside a description to read.
  const pictures = useMemo(
    () =>
      new Map(
        (vault.data?.folders ?? []).flatMap((folder) =>
          folder.media.map((media) => [media.platformMediaId, media] as const),
        ),
      ),
    [vault.data],
  );

  const head = (line: string | null): JSX.Element => (
    <div className="rx-head">
      <p className="ps-title">Ses scripts dans Reveal</p>
      {line === null ? null : <p className="ps-muted nv-num">{line}</p>}
    </div>
  );

  if (natives.data === undefined || prepared.data === undefined) {
    if (natives.isError || prepared.isError)
      return (
        <div className="nv-plate rx">
          {head(null)}
          <Failure
            title="Ses scripts Reveal ne se chargent pas"
            onRetry={() => {
              void natives.refetch();
              void prepared.refetch();
            }}
          />
        </div>
      );
    return <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" aria-busy="true" />;
  }

  const scripts = ourCopies(natives.data, prepared.data);
  const active = scripts.filter((script) => script.active);
  // The first one to review is open at first; then whatever the agency opens or closes.
  const first = active.find((script) => revealStanding(script).opens !== null)?.id ?? null;
  const open = opened === undefined ? first : opened;
  return (
    <section className="nv-plate rx" aria-label="Ses scripts dans Reveal">
      {head(revealSummary(scripts))}
      {active.length === 0 ? (
        <p className="ps-muted">
          Un script prêt à copier arrive ici dès que la synchro de son coffre reconnaît sa copie dans Reveal,
          avec ce qui lui manque pour être proposé. Ses autres scripts Reveal n’y figurent pas.
        </p>
      ) : (
        <ul className="rx-list">
          {active.map((script) => (
            <ScriptRow
              key={script.id}
              creatorId={creatorId}
              script={script}
              open={open === script.id}
              pictures={pictures}
              onToggle={() => {
                setOpened(open === script.id ? null : script.id);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ScriptRow({
  creatorId,
  script,
  open,
  pictures,
  onToggle,
}: {
  creatorId: CreatorId;
  script: PlatformScriptViewDto;
  open: boolean;
  pictures: ReadonlyMap<string, VaultMediaView>;
  onToggle: () => void;
}): JSX.Element {
  const id = useId();
  const standing = revealStanding(script);
  const sheet = standing.opens !== null;
  const top = (
    <>
      <span className="rx-row__text">
        <span className="rx-row__name">
          {script.name}
          {script.moment === null ? null : (
            <span aria-hidden="true">{` ${MOMENT_EMOJIS[script.moment]}`}</span>
          )}
        </span>
        <span className="rx-row__line nv-num" data-tone={standing.tone}>
          {standing.line}
        </span>
        <span className="rx-row__meta nv-num">{priceLine(script)}</span>
      </span>
      <span className="rx-row__end">
        {/* A review waits on a gesture here and carries the full ink's dot; an import is done in the vault, faint. */}
        <span
          className="aa-pill sx-state rx-row__state"
          data-tone={standing.opens === null ? standing.tone : 'review'}
        >
          {standing.label}
        </span>
        {/* Kept on every row, empty where nothing opens: the pills stay in one column. */}
        <span className="rx-row__chev" aria-hidden="true">
          {sheet ? <ChevronIcon /> : null}
        </span>
      </span>
    </>
  );
  return (
    <li className="rx-item" data-open={open && sheet ? '' : undefined}>
      {sheet ? (
        <button
          type="button"
          className="rx-row"
          aria-expanded={open}
          aria-controls={`${id}-sheet`}
          onClick={onToggle}
        >
          {top}
        </button>
      ) : (
        <div className="rx-row">{top}</div>
      )}
      {open && sheet ? (
        <div id={`${id}-sheet`} className="rx-sheet nv-swap">
          {standing.opens === 'descriptions' ? (
            <Descriptions creatorId={creatorId} script={script} pictures={pictures} />
          ) : (
            <Identity creatorId={creatorId} script={script} />
          )}
        </div>
      ) : null}
    </li>
  );
}

/** A review's call: the script answered replaces the one in the list; a refusal is said, and the list read again. */
function useReview(creatorId: CreatorId) {
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: string, call: () => Promise<RevealOutcome>): Promise<boolean> => {
    setBusy(what);
    setError(null);
    const outcome = await call();
    setBusy(null);
    if (outcome.kind === 'ok') {
      client.setQueryData<readonly PlatformScriptViewDto[]>(revealScriptsKey(creatorId), (list) =>
        list?.map((each) => (each.id === outcome.script.id ? outcome.script : each)),
      );
      return true;
    }
    setError(outcome.message);
    await client.invalidateQueries({ queryKey: revealScriptsKey(creatorId) });
    return false;
  };
  return { busy, error, run };
}

/**
 * Its media's descriptions to read, each beside its picture (blurred under « Flou des médias »): « Tout valider »
 * takes those with nothing holding them back; one the AI doubts is validated alone, after it is read.
 */
function Descriptions({
  creatorId,
  script,
  pictures,
}: {
  creatorId: CreatorId;
  script: PlatformScriptViewDto;
  pictures: ReadonlyMap<string, VaultMediaView>;
}): JSX.Element {
  const { busy, error, run } = useReview(creatorId);
  const media = mediaToValidate(script);
  const batch = batchOf(media);
  const validate = (what: string, ids: readonly MediaDescriptionId[]) =>
    void run(what, () => validateScriptDescriptions(creatorId, script.id, ids));
  const alone = media.filter((each) => each.description.reviewReasons.length > 0);
  const item = (each: MediaToValidate): JSX.Element => (
    <MediaToRead
      key={each.description.id}
      creatorId={creatorId}
      media={each}
      picture={pictures.get(each.ref) ?? null}
      busy={busy !== null}
      onValidate={() => {
        validate(each.description.id, [each.description.id]);
      }}
      onCorrect={(detailed) =>
        run(each.description.id, () =>
          correctScriptDescription(creatorId, script.id, each.description.id, detailed),
        )
      }
    />
  );
  return (
    <>
      {error === null ? null : (
        <p className="sx-error nv-swap" role="alert">
          {error}
        </p>
      )}
      {batch.length === 0 ? null : (
        <div className="rx-group">
          <div className="rx-sheet__head">
            <p className="rx-sheet__title nv-num">À relire · {batch.length}</p>
            <button
              type="button"
              className="nv-btn nv-btn--sm nv-btn--neon"
              disabled={busy !== null}
              onClick={() => {
                validate('all', batch);
              }}
            >
              {busy === 'all'
                ? 'Validation…'
                : batch.length === 1
                  ? 'Valider la description'
                  : `Valider les ${String(batch.length)} descriptions`}
            </button>
          </div>
          <ul className="rx-media">
            {media.filter((each) => each.description.reviewReasons.length === 0).map(item)}
          </ul>
        </div>
      )}
      {alone.length === 0 ? null : (
        <div className="rx-group">
          <div className="rx-sheet__head">
            <p className="rx-sheet__title nv-num">À regarder de près · {alone.length}</p>
          </div>
          <ul className="rx-media">{alone.map(item)}</ul>
        </div>
      )}
    </>
  );
}

function MediaToRead({
  creatorId,
  media,
  picture,
  busy,
  onValidate,
  onCorrect,
}: {
  creatorId: CreatorId;
  media: MediaToValidate;
  picture: VaultMediaView | null;
  busy: boolean;
  onValidate: () => void;
  onCorrect: (detailed: string) => Promise<boolean>;
}): JSX.Element {
  const id = useId();
  const blurred = useMediaBlur();
  const [draft, setDraft] = useState<string | null>(null);
  const area = useGrowingArea(draft ?? '');
  const { description } = media;
  const reasons = description.reviewReasons;
  return (
    <li className="rx-medium">
      <span className="rx-thumb" aria-hidden="true">
        <Preview hash={picture?.blurhash ?? null} />
        {picture !== null && !blurred ? <Sharp creatorId={creatorId} media={picture} /> : null}
      </span>
      <div className="rx-medium__body">
        <p className="rx-medium__where nv-num">{placeOf(media)}</p>
        {draft === null ? (
          <>
            <p className="sx-medium__text">{description.detailed}</p>
            {reasons.length === 0 ? null : (
              <ul className="sx-reasons" aria-label="À vérifier">
                {reasons.map((reason) => (
                  <li key={reason} className="sx-reason" data-tone={reason === 'flagged' ? 'alert' : 'warn'}>
                    {REASON_LABELS[reason]}
                  </li>
                ))}
              </ul>
            )}
            <div className="rx-medium__actions">
              <button
                type="button"
                className="nv-btn nv-btn--sm nv-btn--plain"
                disabled={busy}
                onClick={() => {
                  setDraft(description.detailed);
                }}
              >
                Corriger
              </button>
              {/* Held by the code: one the AI doubts is validated alone, never under « Valider les … ». */}
              {reasons.length > 0 ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--sm nv-btn--soft"
                  disabled={busy}
                  onClick={onValidate}
                >
                  Valider celle-ci
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <form
            className="nv-field sx-correct"
            onSubmit={(event) => {
              event.preventDefault();
              const text = draft.trim();
              if (text === '') return;
              void onCorrect(text).then((done) => {
                if (done) setDraft(null);
              });
            }}
          >
            <label className="nv-field__label" htmlFor={`${id}-text`}>
              Ce que montre {media.kind === 'video' ? 'la vidéo' : 'la photo'}
            </label>
            <textarea
              id={`${id}-text`}
              ref={area}
              className="nv-field__control sx-correct__area"
              value={draft}
              maxLength={6000}
              rows={3}
              data-autofocus
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
            <div className="rx-medium__actions">
              <button
                type="button"
                className="nv-btn nv-btn--sm nv-btn--plain"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                }}
              >
                Annuler
              </button>
              <button
                type="submit"
                className="nv-btn nv-btn--sm nv-btn--soft"
                disabled={busy || draft.trim() === ''}
              >
                Enregistrer et valider
              </button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}

/** The cues as written, one per line: empty lines dropped, each cut to its bound, five at most. */
const cuesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim().slice(0, SCRIPT_IDENTITY_TEXT_MAX))
    .filter((line) => line !== '')
    .slice(0, SCRIPT_IDENTITY_CUES_MAX);

/**
 * Its identity, as the AI wrote it from the validated descriptions: what the agent reads to pick this script. Validated
 * as it is, or rewritten by hand (validated as it is saved).
 */
function Identity({
  creatorId,
  script,
}: {
  creatorId: CreatorId;
  script: PlatformScriptViewDto;
}): JSX.Element {
  const { busy, error, run } = useReview(creatorId);
  const [draft, setDraft] = useState<ScriptIdentityContent | null>(null);
  const identity = script.identity;
  if (identity === null) return <p className="ps-muted">L’IA écrit son identité.</p>;
  const content = identity.content;
  if (draft !== null)
    return (
      <IdentityForm
        draft={draft}
        busy={busy !== null}
        error={error}
        onChange={setDraft}
        onClose={() => {
          setDraft(null);
        }}
        onSave={(written) => run('identity', () => correctScriptIdentity(creatorId, script.id, written))}
      />
    );
  return (
    <>
      <div className="rx-sheet__head">
        <p className="rx-sheet__title">Son identité</p>
        <div className="rx-sheet__actions">
          <button
            type="button"
            className="nv-btn nv-btn--sm nv-btn--plain"
            disabled={busy !== null}
            onClick={() => {
              setDraft(content);
            }}
          >
            Corriger
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--sm nv-btn--neon"
            disabled={busy !== null}
            onClick={() =>
              void run('identity', () => validateScriptIdentity(creatorId, script.id, identity.id))
            }
          >
            {busy === 'identity' ? 'Validation…' : 'Valider l’identité'}
          </button>
        </div>
      </div>
      {error === null ? null : (
        <p className="sx-error nv-swap" role="alert">
          {error}
        </p>
      )}
      <dl className="rx-identity">
        <div className="rx-identity__row">
          <dt>Ambiance</dt>
          <dd>{content.ambiance}</dd>
        </div>
        <div className="rx-identity__row">
          <dt>Énergie</dt>
          <dd>{ENERGY_VALUES[content.energy]}</dd>
        </div>
        <div className="rx-identity__row">
          <dt>Décor</dt>
          <dd>{content.setting}</dd>
        </div>
        <div className="rx-identity__row">
          <dt>À proposer quand</dt>
          <dd>
            <ul className="rx-cues">
              {content.useWhen.map((cue) => (
                <li key={cue}>{cue}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="rx-identity__row">
          <dt>À éviter quand</dt>
          <dd>
            {content.avoidWhen.length === 0 ? (
              <span className="ps-muted">Rien de particulier</span>
            ) : (
              <ul className="rx-cues">
                {content.avoidWhen.map((cue) => (
                  <li key={cue}>{cue}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </>
  );
}

function IdentityForm({
  draft,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  draft: ScriptIdentityContent;
  busy: boolean;
  error: string | null;
  onChange: (draft: ScriptIdentityContent) => void;
  onClose: () => void;
  onSave: (written: ScriptIdentityContent) => Promise<boolean>;
}): JSX.Element {
  const id = useId();
  const [useWhen, setUseWhen] = useState(draft.useWhen.join('\n'));
  const [avoidWhen, setAvoidWhen] = useState(draft.avoidWhen.join('\n'));
  const useArea = useGrowingArea(useWhen);
  const avoidArea = useGrowingArea(avoidWhen);
  const written: ScriptIdentityContent = {
    ambiance: draft.ambiance.trim(),
    energy: draft.energy,
    setting: draft.setting.trim(),
    useWhen: cuesOf(useWhen),
    avoidWhen: cuesOf(avoidWhen),
  };
  const ready = written.ambiance !== '' && written.setting !== '' && written.useWhen.length > 0;
  return (
    <form
      className="sx-correct rx-identity-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        void onSave(written).then((done) => {
          if (done) onClose();
        });
      }}
    >
      <p className="rx-sheet__title">Corriger son identité</p>
      <p className="ps-muted">Ce que tu écris remplace celle de l’IA et vaut validation.</p>
      <div className="nv-field">
        <label className="nv-field__label" htmlFor={`${id}-ambiance`}>
          Ambiance
        </label>
        <input
          id={`${id}-ambiance`}
          className="nv-field__control"
          value={draft.ambiance}
          maxLength={SCRIPT_IDENTITY_TEXT_MAX}
          data-autofocus
          onChange={(event) => {
            onChange({ ...draft, ambiance: event.target.value });
          }}
        />
      </div>
      <div className="nv-field">
        <span className="nv-field__label" id={`${id}-energy`}>
          Énergie
        </span>
        <div className="sx-levels" role="radiogroup" aria-labelledby={`${id}-energy`}>
          {SCRIPT_ENERGIES.map((one: ScriptEnergy) => (
            <button
              key={one}
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={draft.energy === one}
              onClick={() => {
                onChange({ ...draft, energy: one });
              }}
            >
              {ENERGY_LABELS[one]}
            </button>
          ))}
        </div>
      </div>
      <div className="nv-field">
        <label className="nv-field__label" htmlFor={`${id}-setting`}>
          Décor
        </label>
        <input
          id={`${id}-setting`}
          className="nv-field__control"
          value={draft.setting}
          maxLength={SCRIPT_IDENTITY_TEXT_MAX}
          onChange={(event) => {
            onChange({ ...draft, setting: event.target.value });
          }}
        />
      </div>
      <div className="nv-field">
        <label className="nv-field__label" htmlFor={`${id}-use`}>
          À proposer quand (une situation par ligne)
        </label>
        <textarea
          id={`${id}-use`}
          ref={useArea}
          className="nv-field__control sx-correct__area"
          value={useWhen}
          rows={2}
          onChange={(event) => {
            setUseWhen(event.target.value);
          }}
        />
      </div>
      <div className="nv-field">
        <label className="nv-field__label" htmlFor={`${id}-avoid`}>
          À éviter quand (une par ligne, facultatif)
        </label>
        <textarea
          id={`${id}-avoid`}
          ref={avoidArea}
          className="nv-field__control sx-correct__area"
          value={avoidWhen}
          rows={2}
          onChange={(event) => {
            setAvoidWhen(event.target.value);
          }}
        />
      </div>
      {error === null ? null : (
        <p className="sx-error nv-swap" role="alert">
          {error}
        </p>
      )}
      <div className="rx-medium__actions">
        <button type="button" className="nv-btn nv-btn--sm nv-btn--plain" disabled={busy} onClick={onClose}>
          Annuler
        </button>
        <button type="submit" className="nv-btn nv-btn--sm nv-btn--soft" disabled={busy || !ready}>
          Enregistrer et valider
        </button>
      </div>
    </form>
  );
}
