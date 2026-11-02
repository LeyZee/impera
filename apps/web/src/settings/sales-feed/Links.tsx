import type {
  LinkSalesFeedChatterBody,
  Platform,
  SalesFeedAccountChoice,
  SalesFeedChatterLink,
  SalesFeedModelLink,
  SalesFeedOverview,
} from '@nirvana/contracts';
import { useState, type JSX } from 'react';

import { linkChatter, linkModel } from './api';
import { platformName, shownOf } from './shown';
import {
  accountOptionsOf,
  chatterName,
  chatterValueOf,
  memberChoicesOf,
  modelLabel,
  modelQuarantineLine,
  dayTime,
} from './view';

import { useMembers } from '@/screens/team/api';
import { SignInAgain } from '@/settings/services/PasswordPrompt';
import type { ShownError } from '@/settings/services/api';

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
 * Each model of the platform and the Nirvana account its sales count for (ADR 0050 § 3). A model nobody linked keeps
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
          Chaque modèle de {name} compte pour un compte de Nirvana. Tant qu’un modèle n’est relié à aucun, ses
          ventes attendent à part et ne comptent nulle part.
        </p>
        {models.some((model) => model.linkedBy?.kind === 'auto') ? (
          <p className="sv-muted">
            « Relié par pseudo identique » : relié tout seul à la connexion, parce que le pseudo est le même.
            Vérifie que c’est le bon compte.
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
                <span className="nv-tag nv-tag--inferred">Relié par pseudo identique</span>
              ) : null}
            </div>
            <select
              className="nv-field__control nv-glass sf-select"
              aria-label={`Compte de ${label}`}
              value={model.platformAccountId ?? ''}
              disabled={rows.busy !== null}
              onChange={(event) => {
                const value = event.target.value === '' ? null : event.target.value;
                save(id, `${label} n’a pas été relié.`, () => linkModel(platform, id, value));
              }}
            >
              <option value="">Aucun compte</option>
              {options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </select>
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

function linkOf(value: string): LinkSalesFeedChatterBody {
  if (value === 'agent') return { kind: 'agent' };
  if (value.startsWith('member:')) return { kind: 'member', memberId: value.slice('member:'.length) };
  return { kind: 'none' };
}

/**
 * Who is who in the platform's team (ADR 0050 § 5): a team member, the agent, or nobody yet. Pay reads these links
 * later (CRM-03); no sale is attributed here.
 */
export function ChatterLinks({
  platform,
  chatters,
  onChanged,
}: {
  platform: Platform;
  chatters: readonly SalesFeedChatterLink[];
  onChanged: (overview: SalesFeedOverview) => void;
}): JSX.Element | null {
  const { rows, save } = useRows(onChanged);
  const members = useMembers(chatters.length > 0);
  if (chatters.length === 0) return null;
  const name = platformName(platform);
  const team = members.data ?? [];
  return (
    <section className="nv-plate sf-links" aria-labelledby={`sf-team-${platform}`}>
      <header className="sf-links__head">
        <h3 id={`sf-team-${platform}`} className="sf-links__title">
          Équipe {name}
        </h3>
        <p className="sv-muted">
          Chaque compte de l’équipe {name} est un membre de l’équipe Nirvana, ou l’agent. La paie lira ce lien
          ; aucune vente n’est attribuée ici.
        </p>
        {members.isError ? (
          <p className="sf-warn">
            La liste de l’équipe n’a pas pu être lue : les membres déjà reliés restent.
          </p>
        ) : null}
      </header>
      {chatters.map((chatter) => {
        const id = chatter.platformChatterId;
        const label = chatterName(chatter);
        const linkedId = chatter.link?.kind === 'member' ? chatter.link.memberId : null;
        const choices = memberChoicesOf(team, linkedId);
        const isLinkedUnknown = linkedId !== null && !choices.some((member) => member.id === linkedId);
        return (
          <div className="sf-row" key={id}>
            <div className="sf-row__name">
              <span>{label}</span>
              {chatter.isBot ? <span className="nv-tag nv-tag--declared">Bot</span> : null}
              {chatter.isExternal ? <span className="nv-tag nv-tag--declared">Externe</span> : null}
              {chatter.removedAt === null ? null : (
                <span className="nv-tag nv-tag--inferred">Retiré le {dayTime(chatter.removedAt)}</span>
              )}
            </div>
            <select
              className="nv-field__control nv-glass sf-select"
              aria-label={`Lien de ${label}`}
              value={chatterValueOf(chatter)}
              disabled={rows.busy !== null}
              onChange={(event) => {
                const link = linkOf(event.target.value);
                save(id, `${label} n’a pas été relié.`, () => linkChatter(platform, id, link));
              }}
            >
              <option value="none">Personne</option>
              <option value="agent">L’agent</option>
              {isLinkedUnknown ? <option value={`member:${linkedId}`}>Membre relié</option> : null}
              {choices.map((member) => (
                <option key={member.id} value={`member:${member.id}`}>
                  {member.displayName}
                  {member.status === 'left' ? ' (parti)' : ''}
                </option>
              ))}
            </select>
            <RowError id={id} rows={rows} />
          </div>
        );
      })}
    </section>
  );
}
