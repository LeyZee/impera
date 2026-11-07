import type {
  Platform,
  SalesFeedAccountChoice,
  SalesFeedModelLink,
  SalesFeedOverview,
} from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { linkModel, useTeamImportCounts } from './api';
import { platformName, shownOf } from './shown';
import { accountOptionsOf, modelLabel, modelQuarantineLine } from './view';

import { newcomersLine, removalsLine } from '@/screens/team/reveal';
import { SignInAgain } from '@/settings/services/PasswordPrompt';
import type { ShownError } from '@/settings/services/api';
import { Select } from '@/shell/Select';

/** The list's value for a model tied to no account: the API's `null`. */
const NO_ACCOUNT = '';

/** The row being saved, and the refusal of the last row saved: one at a time, said under that row. */
interface RowState {
  readonly busy: string | null;
  readonly failed: { readonly id: string; readonly error: ShownError } | null;
}
const IDLE: RowState = { busy: null, failed: null };

function useRows(onChanged: (overview: SalesFeedOverview) => void): {
  rows: RowState;
  save: (id: string, lead: string, call: () => Promise<SalesFeedOverview>) => void;
} {
  const [rows, setRows] = useState<RowState>(IDLE);
  const save = (id: string, lead: string, call: () => Promise<SalesFeedOverview>): void => {
    setRows({ busy: id, failed: null });
    call().then(
      (overview) => {
        setRows(IDLE);
        onChanged(overview);
      },
      (error: unknown) => {
        setRows({ busy: null, failed: { id, error: shownOf(error, lead) } });
      },
    );
  };
  return { rows, save };
}

function RowError({ id, rows }: { id: string; rows: RowState }): JSX.Element | null {
  if (rows.failed?.id !== id) return null;
  return (
    <>
      <p className="sv-notice sf-row__msg" role="alert" data-tone="error">
        {rows.failed.error.message}
      </p>
      {rows.failed.error.isSessionExpired ? <SignInAgain /> : null}
    </>
  );
}

/**
 * Each model of the platform and the Impera account its sales count for (ADR 0050 § 3). A model nobody linked keeps
 * its sales in quarantine, counted nowhere; linking it moves them into the register in the same step.
 */
export function ModelLinks({
  platform,
  models,
  accounts,
  onChanged,
}: {
  platform: Platform;
  models: readonly SalesFeedModelLink[];
  accounts: readonly SalesFeedAccountChoice[];
  onChanged: (overview: SalesFeedOverview) => void;
}): JSX.Element | null {
  const { rows, save } = useRows(onChanged);
  if (models.length === 0) return null;
  const name = platformName(platform);
  return (
    <section className="nv-plate sf-links" aria-labelledby={`sf-models-${platform}`}>
      <header className="sf-links__head">
        <h3 id={`sf-models-${platform}`} className="sf-links__title">
          Modèles {name}
        </h3>
        <p className="sv-muted">
          Chaque modèle de {name} compte pour un compte d’Impera. Tant qu’un modèle n’est relié à aucun, ses
          ventes attendent à part et ne comptent nulle part.
        </p>
        {models.some((model) => model.linkedBy?.kind === 'auto') ? (
          <p className="sv-muted">
            « Relié par pseudo identique » : relié tout seul à la connexion, parce que le pseudo est le même.
            Vérifie que c’est le bon compte, puis confirme-le : le lien devient le tien.
          </p>
        ) : null}
      </header>
      {models.map((model) => {
        const id = model.platformModelId;
        const label = modelLabel(model);
        const options = accountOptionsOf(model, accounts, models);
        return (
          <div className="sf-row" key={id}>
            <div className="sf-row__name">
              <span>{label}</span>
              {model.linkedBy?.kind === 'auto' ? (
                <>
                  <span className="nv-tag nv-tag--inferred">Relié par pseudo identique</span>
                  {/* The same link posed again by the owner confirms it (#413): nothing moves. */}
                  <button
                    type="button"
                    className="nv-btn nv-btn--soft nv-btn--sm"
                    aria-label={`Confirmer le compte de ${label}`}
                    disabled={rows.busy !== null}
                    onClick={() => {
                      save(id, `${label} n’a pas été confirmé.`, () =>
                        linkModel(platform, id, model.platformAccountId),
                      );
                    }}
                  >
                    {rows.busy === id ? 'Confirmation…' : 'Confirmer'}
                  </button>
                </>
              ) : null}
            </div>
            <Select
              className="sf-select"
              ariaLabel={`Compte de ${label}`}
              value={model.platformAccountId ?? NO_ACCOUNT}
              disabled={rows.busy !== null}
              options={[{ value: NO_ACCOUNT, label: 'Aucun compte' }, ...options]}
              onChange={(value) => {
                const account = value === NO_ACCOUNT ? null : value;
                save(id, `${label} n’a pas été relié.`, () => linkModel(platform, id, account));
              }}
            />
            {model.quarantined > 0 ? (
              <p className="sf-warn sf-row__msg">{modelQuarantineLine(model.quarantined)}</p>
            ) : null}
            <RowError id={id} rows={rows} />
          </div>
        );
      })}
    </section>
  );
}

/**
 * Who is who in the platform's team (ADR 0050 § 5, ADR 0076): reviewed in Équipe › Reveal, where an active manager
 * links and invites too. Here, the way there and what waits in it.
 */
export function TeamLink({ platform }: { platform: Platform }): JSX.Element | null {
  const counts = useTeamImportCounts(platform, platform === 'reveal').data;
  if (platform !== 'reveal') return null;
  const name = platformName(platform);
  return (
    <section className="nv-plate sf-links" aria-labelledby={`sf-team-${platform}`}>
      <header className="sf-links__head">
        <h3 id={`sf-team-${platform}`} className="sf-links__title">
          Équipe {name}
        </h3>
        <p className="sv-muted">
          Chaque compte de l’équipe {name} se relie à un membre, à l’agent ou à personne dans Équipe › {name},
          où tes managers actifs relient et invitent aussi. La paie lit ces liens.
        </p>
        {counts === undefined || counts.newCount === 0 ? null : (
          <p className="sv-muted">{newcomersLine(counts.newCount, name)}.</p>
        )}
        {counts === undefined || counts.removalCount === 0 ? null : (
          <p className="sf-warn">{removalsLine(counts.removalCount, name)}.</p>
        )}
      </header>
      <div className="sf-import__foot">
        <Link to="/equipe/reveal" className="nv-btn nv-btn--soft">
          Ouvrir Équipe › {name}
        </Link>
      </div>
    </section>
  );
}
