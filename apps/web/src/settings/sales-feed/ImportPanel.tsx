import {
  SALES_FEED_IMPORT_MAX_LINES,
  type Platform,
  type SalesFeedDismissedModel,
  type SalesFeedImportCandidate,
  type SalesFeedImportLineResult,
  type SalesFeedOverview,
} from '@impera/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState, type JSX } from 'react';

import { importModels, setDismissal } from './api';
import {
  actionOf,
  actionValue,
  batchesOf,
  creatorOptionsOf,
  foundTitle,
  initialsOf,
  isStatusWarning,
  modelLabel,
  modelName,
  proposalWhy,
  proposedChoice,
  refusalLine,
  selectedLines,
  statusLabel,
  summaryOf,
  type CreatorOption,
  type ImportChoice,
} from './importing';
import { platformName, shownOf } from './shown';

import { creatorsQuery } from '@/creators/api';
import { creatorsSearch } from '@/creators/search';
import { PasswordPrompt, SignInAgain } from '@/settings/services/PasswordPrompt';
import { ReauthRequired, type ShownError } from '@/settings/services/api';

/** What the last import did, line by line, with each model's name as it was shown (she leaves the list after). */
interface Done {
  readonly lines: readonly SalesFeedImportLineResult[];
  readonly labels: ReadonlyMap<string, string>;
}

type Busy = { readonly kind: 'import' } | { readonly kind: 'dismissal'; readonly id: string } | null;

/**
 * « N créatrices trouvées sur Reveal » (CRM-07 lot b, ADR 0069): the models of the platform with no creator in
 * Impera yet, each with what the server proposes (link her to a creator who has her handle or her name, or create
 * her), ticked in advance when she is validated and active. The owner changes a line, dismisses one, and imports the
 * selection, her password asked again. Her photo stays at the platform until the import copies it: the page loads
 * nothing from elsewhere, so her tile shows her initials.
 */
export function ImportPanel({
  platform,
  candidates,
  dismissed,
  onChanged,
}: {
  platform: Platform;
  candidates: readonly SalesFeedImportCandidate[];
  dismissed: readonly SalesFeedDismissedModel[];
  onChanged: (overview: SalesFeedOverview) => void;
}): JSX.Element | null {
  const name = platformName(platform);
  const titleId = useId();
  // Her creators to link to, read only when there is a line to choose for.
  const creators = useQuery({ ...creatorsQuery, enabled: candidates.length > 0 });
  const [choices, setChoices] = useState<ReadonlyMap<string, ImportChoice>>(new Map());
  const [busy, setBusy] = useState<Busy>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [failed, setFailed] = useState<{ readonly id: string | null; readonly error: ShownError } | null>(
    null,
  );

  if (candidates.length === 0 && dismissed.length === 0 && done === null) return null;

  const options = creatorOptionsOf(creators.data ?? [], candidates);
  const lines = selectedLines(candidates, choices);
  const choiceOf = (candidate: SalesFeedImportCandidate): ImportChoice =>
    choices.get(candidate.model.platformModelId) ?? proposedChoice(candidate);
  const change = (candidate: SalesFeedImportCandidate, patch: Partial<ImportChoice>): void => {
    setChoices((current) => {
      const next = new Map(current);
      next.set(candidate.model.platformModelId, { ...choiceOf(candidate), ...patch });
      return next;
    });
  };

  const runImport = (): void => {
    setFailed(null);
    setBusy({ kind: 'import' });
    const labels = new Map(candidates.map((c) => [c.model.platformModelId, modelLabel(c.model)]));
    // The server takes 100 lines per call: a bigger selection goes in turns, and
    // what a turn already did stays shown if a later one fails.
    const sent: SalesFeedImportLineResult[] = [];
    const sendAll = async (): Promise<void> => {
      for (const batch of batchesOf(lines, SALES_FEED_IMPORT_MAX_LINES)) {
        const result = await importModels(platform, { lines: batch });
        sent.push(...result.lines);
        setDone({ lines: [...sent], labels });
        onChanged(result.overview);
      }
      setChoices(new Map());
    };
    sendAll()
      .catch((error: unknown) => {
        if (error instanceof ReauthRequired) {
          setIsAsking(true);
          return;
        }
        const lead = sent.length === 0 ? 'Rien n’a été importé.' : 'Le reste n’a pas été importé.';
        setFailed({ id: null, error: shownOf(error, lead) });
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const dismissal = (id: string, label: string, isDismissed: boolean): void => {
    setFailed(null);
    setBusy({ kind: 'dismissal', id });
    setDismissal(platform, id, isDismissed)
      .then(onChanged, (error: unknown) => {
        const lead = isDismissed ? `${label} n’a pas été écartée.` : `${label} n’a pas été reprise.`;
        setFailed({ id, error: shownOf(error, lead) });
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const isBusy = busy !== null || isAsking;

  return (
    <section className="nv-plate sf-links sf-import" aria-labelledby={titleId}>
      <header className="sf-links__head">
        <h3 id={titleId} className="sf-links__title">
          {foundTitle(candidates.length, name)}
        </h3>
        {candidates.length === 0 ? null : (
          <p className="sv-muted">
            Coche celles à ajouter à Impera. Une créatrice déjà là est reliée&nbsp;; sinon sa fiche est créée
            avec son nom et son pseudo de {name}. Rien ne change chez {name}.
          </p>
        )}
      </header>

      {/* What the click just did comes first, above what is left to choose. */}
      {done === null ? null : <ImportDone done={done} platformName={name} />}

      {candidates.length === 0 ? null : (
        <ul className="sf-import__list" aria-label={`Créatrices de ${name} à importer`}>
          {candidates.map((candidate) => (
            <CandidateRow
              key={candidate.model.platformModelId}
              candidate={candidate}
              platformName={name}
              choice={choiceOf(candidate)}
              options={options}
              disabled={isBusy}
              isDismissing={busy?.kind === 'dismissal' && busy.id === candidate.model.platformModelId}
              failed={failed?.id === candidate.model.platformModelId ? failed.error : null}
              onChange={(patch) => {
                change(candidate, patch);
              }}
              onDismiss={() => {
                dismissal(candidate.model.platformModelId, modelLabel(candidate.model), true);
              }}
            />
          ))}
        </ul>
      )}

      {candidates.length === 0 ? null : (
        <div className="sf-import__foot">
          <button
            type="button"
            className="nv-btn nv-btn--neon"
            disabled={lines.length === 0 || isBusy}
            onClick={runImport}
          >
            {busy?.kind === 'import'
              ? 'Import…'
              : lines.length === 0
                ? 'Importer la sélection'
                : `Importer la sélection (${String(lines.length)})`}
          </button>
          <p className="sv-muted sf-import__count" aria-live="polite">
            {lines.length === 0
              ? 'Coche au moins une créatrice.'
              : `${String(lines.length)} sur ${String(candidates.length)} cochée${lines.length > 1 ? 's' : ''}`}
          </p>
        </div>
      )}

      {isAsking ? (
        <div className="nv-confirm sv-confirm sf-import__ask">
          <PasswordPrompt
            lead="Pour ajouter des créatrices, confirme ton mot de passe et ton code."
            onConfirmed={() => {
              setIsAsking(false);
              runImport();
            }}
            onCancel={() => {
              setIsAsking(false);
            }}
          />
        </div>
      ) : null}

      {failed !== null && failed.id === null ? (
        <div className="sf-import__msg">
          <p className="sv-notice" role="alert" data-tone="error">
            {failed.error.message}
          </p>
          {failed.error.isSessionExpired ? <SignInAgain /> : null}
        </div>
      ) : null}

      {dismissed.length === 0 ? null : (
        <details className="sf-dismissed">
          <summary className="sf-dismissed__title">
            Écartées <span className="sf-faint">{dismissed.length}</span>
          </summary>
          <ul className="sf-import__list">
            {dismissed.map((entry) => {
              const id = entry.model.platformModelId;
              const label = modelLabel(entry.model);
              return (
                <li key={id} className="sf-imp sf-imp--dismissed">
                  <Face model={entry.model} />
                  <Who model={entry.model} platformName={name} />
                  <button
                    type="button"
                    className="nv-btn nv-btn--soft nv-btn--sm sf-imp__end"
                    aria-label={`Reprendre ${label}`}
                    disabled={isBusy}
                    onClick={() => {
                      dismissal(id, label, false);
                    }}
                  >
                    {busy?.kind === 'dismissal' && busy.id === id ? 'Reprise…' : 'Reprendre'}
                  </button>
                  {failed?.id === id ? <RowError error={failed.error} /> : null}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}

function Face({ model }: { model: SalesFeedImportCandidate['model'] }): JSX.Element {
  return (
    <span className="sf-imp__face" aria-hidden="true">
      {initialsOf(modelName(model))}
    </span>
  );
}

function Who({
  model,
  platformName: name,
}: {
  model: SalesFeedImportCandidate['model'];
  platformName: string;
}): JSX.Element {
  const hasName = model.displayName.trim() !== '';
  return (
    <div className="sf-imp__who">
      <span className="sf-imp__name">{modelName(model)}</span>
      <span className="sf-imp__meta">
        {hasName ? `@${model.handle} · ` : null}
        <span className="sf-imp__status" data-warn={isStatusWarning(model) ? 'true' : undefined}>
          {statusLabel(model, name)}
        </span>
      </span>
    </div>
  );
}

function RowError({ error }: { error: ShownError }): JSX.Element {
  return (
    <div className="sf-imp__msg">
      <p className="sv-notice" role="alert" data-tone="error">
        {error.message}
      </p>
      {error.isSessionExpired ? <SignInAgain /> : null}
    </div>
  );
}

function CandidateRow({
  candidate,
  platformName: name,
  choice,
  options,
  disabled,
  isDismissing,
  failed,
  onChange,
  onDismiss,
}: {
  candidate: SalesFeedImportCandidate;
  platformName: string;
  choice: ImportChoice;
  options: readonly CreatorOption[];
  disabled: boolean;
  isDismissing: boolean;
  failed: ShownError | null;
  onChange: (patch: Partial<ImportChoice>) => void;
  onDismiss: () => void;
}): JSX.Element {
  const { model } = candidate;
  const label = modelLabel(model);
  const why = proposalWhy(candidate);
  const isProposed = actionValue(choice.action) === actionValue(proposedChoice(candidate).action);
  return (
    <li className="sf-imp">
      <input
        type="checkbox"
        className="sf-imp__pick"
        aria-label={`Importer ${label}`}
        checked={choice.selected}
        disabled={disabled}
        onChange={(event) => {
          onChange({ selected: event.target.checked });
        }}
      />
      <Face model={model} />
      <Who model={model} platformName={name} />
      <div className="sf-imp__act">
        <select
          className="nv-field__control nv-glass sf-select"
          aria-label={`Que faire de ${label}`}
          value={actionValue(choice.action)}
          disabled={disabled}
          onChange={(event) => {
            onChange({ action: actionOf(event.target.value, options), selected: true });
          }}
        >
          <option value="create">Créer sa fiche</option>
          {options.map((option) => (
            <option key={option.id} value={`link:${option.id}`}>
              Relier à {option.name}
            </option>
          ))}
        </select>
        {why !== null && isProposed ? <span className="sf-imp__why">{why}</span> : null}
      </div>
      <button
        type="button"
        className="nv-btn nv-btn--plain nv-btn--sm sf-imp__end"
        aria-label={`Écarter ${label}`}
        disabled={disabled}
        onClick={onDismiss}
      >
        {isDismissing ? 'Écartement…' : 'Écarter'}
      </button>
      {failed === null ? null : <RowError error={failed} />}
    </li>
  );
}

/** What the import did: a sentence, then the lines, each created one with the way to her sheet. */
function ImportDone({ done, platformName: name }: { done: Done; platformName: string }): JSX.Element {
  const created = done.lines.some((line) => line.outcome === 'created');
  return (
    <div className="sf-import__done" role="status">
      <p className="sf-import__summary">{summaryOf(done.lines)}</p>
      <ul className="sf-import__results">
        {done.lines.map((line) => {
          const label = done.labels.get(line.platformModelId) ?? line.platformModelId;
          return (
            <li key={line.platformModelId} className="sf-res" data-outcome={line.outcome}>
              <span className="sf-res__text">
                <span className="sf-res__name">{label}</span>
                <span className="sf-res__what">
                  {line.outcome === 'refused'
                    ? refusalLine(line.reason, name)
                    : line.outcome === 'created'
                      ? 'Fiche créée.'
                      : line.outcome === 'linked'
                        ? 'Reliée.'
                        : 'Déjà reliée.'}
                </span>
              </span>
              {line.outcome !== 'refused' ? (
                <Link
                  to="/creatrices"
                  search={creatorsSearch('persona', line.creatorId)}
                  className="nv-btn nv-btn--soft nv-btn--sm sf-res__open"
                >
                  Voir sa fiche
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      {created ? (
        <p className="sv-muted">
          Sur chaque fiche créée, il reste son pourcentage, son fuseau (Paris par défaut), sa persona et son
          invitation.
        </p>
      ) : null}
    </div>
  );
}
