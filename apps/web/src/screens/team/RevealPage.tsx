import type {
  CreatorSummary,
  Platform,
  TeamImportLinksBody,
  TeamImportOverview,
  TeamImportRow,
  TeamMember,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { AddMemberPanel } from './AddMemberPanel';
import { TeamNav } from './TeamNav';
import { MEMBERS_KEY, PLATFORM_REMOVALS_KEY, useMembers, usePresets } from './api';
import { removalLine } from './model';
import { Notice, Unread } from './parts';
import {
  chatterName,
  choiceOf,
  gapLine,
  initialBatch,
  linkLabel,
  linkOf,
  linkedChoiceOf,
  matchLine,
  modelsLine,
  newcomersLine,
  optionsOf,
  removalsLine,
  removedLine,
  sectionsOf,
  tickedCount,
  type Choice,
} from './reveal';

import { useCreators } from '@/creators/api';
import {
  linkTeam,
  setChatterDismissal,
  teamImportCountsKey,
  teamImportKey,
  useTeamImport,
} from '@/settings/sales-feed/api';
import { initialsOf } from '@/settings/sales-feed/importing';
import { platformName, shownOf } from '@/settings/sales-feed/shown';
import { SignInAgain } from '@/settings/services/PasswordPrompt';
import { isForbidden, type ShownError } from '@/settings/services/api';
import { Select } from '@/shell/Select';
import { Page, PageHeader, Panel } from '@/shell/layout';
import '@/settings/services/services.css';
import '@/settings/sales-feed/sales-feed.css';
import './team.css';

/** The server takes 200 rows per call: a bigger selection goes in turns. */
const BATCH_MAX = 200;

/** A row's choice as the reader left it, over its proposal. */
interface Edit {
  readonly choice: Choice;
  readonly ticked: boolean;
}

type Busy =
  | { readonly kind: 'batch' }
  | { readonly kind: 'row'; readonly id: string }
  | { readonly kind: 'dismissal'; readonly id: string }
  | null;

/**
 * Équipe › Reveal (ADR 0076): each account of the platform's team with its link or a proposal, that the owner or an
 * active manager confirms, ticked rows in one batch, an invitation one row at a time. Nothing is linked or created
 * without a click; the server answers what this viewer may do on each row, and refuses the rest whatever shows.
 */
export function RevealPage({
  platform,
  bounded,
  ownCreatorIds,
  onOpenMember,
}: {
  platform: Platform;
  /** An active manager: he invites a chatter, at a preset of the owner's, with creators of his own list (§ 3). */
  bounded: boolean;
  /** His own list of creators, the only ones a manager gives (« ok créatrices-liste-manager »). */
  ownCreatorIds: readonly string[];
  onOpenMember: (memberId: string) => void;
}): JSX.Element {
  const name = platformName(platform);
  const client = useQueryClient();
  const overview = useTeamImport(platform);
  const members = useMembers();
  const presets = usePresets();
  const creators = useCreators();
  const [edits, setEdits] = useState<ReadonlyMap<string, Edit>>(new Map());
  const [busy, setBusy] = useState<Busy>(null);
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, ShownError>>(new Map());
  const [failed, setFailed] = useState<ShownError | null>(null);
  const [inviting, setInviting] = useState<TeamImportRow | null>(null);

  const land = (next: TeamImportOverview): void => {
    client.setQueryData(teamImportKey(platform), next);
    void client.invalidateQueries({ queryKey: teamImportCountsKey(platform) });
    void client.invalidateQueries({ queryKey: PLATFORM_REMOVALS_KEY });
  };

  const header = (
    <PageHeader
      title="Équipe"
      lead={`Chaque compte de l’équipe ${name} se relie à un membre, à l’agent ou à personne. Rien n’est relié sans confirmation.`}
      actions={<TeamNav />}
    />
  );

  if (overview.isPending) {
    return (
      <Page>
        {header}
        <Panel className="tm-panel">
          <div className="tm-skeleton" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </Panel>
      </Page>
    );
  }
  if (overview.isError) {
    return (
      <Page>
        {header}
        {isForbidden(overview.error) ? (
          <Notice
            title="Réservé au propriétaire et aux managers actifs"
            text={`La revue de l’équipe ${name} ne s’ouvre pas sur ce compte.`}
          />
        ) : (
          <Unread
            text={`${shownOf(overview.error).message} L’équipe ${name} n’a pas pu être lue.`}
            onRetry={() => {
              void overview.refetch();
            }}
          />
        )}
      </Page>
    );
  }

  const data = overview.data;
  const team = members.data ?? [];
  const { toConfirm, linked, folded } = sectionsOf(data.rows);
  const seed = initialBatch(data.rows);
  const editOf = (row: TeamImportRow): Edit => {
    const id = row.chatter.platformChatterId;
    return (
      edits.get(id) ?? {
        choice: seed.choices[id] ?? choiceOf(row.suggestion),
        ticked: seed.ticked.includes(id),
      }
    );
  };
  const edit = (row: TeamImportRow, patch: Partial<Edit>): void => {
    setEdits((current) => {
      const next = new Map(current);
      next.set(row.chatter.platformChatterId, { ...editOf(row), ...patch });
      return next;
    });
  };
  // The rows the batch may take: those without a link that this viewer may confirm, bots of the fold included.
  const confirmable = data.rows.filter(
    (row) => row.link === null && row.dismissedAt === null && row.actions.length > 0,
  );
  const items: TeamImportLinksBody['items'] = confirmable.flatMap((row) => {
    const { choice, ticked } = editOf(row);
    const link = linkOf(choice);
    return ticked && link !== null ? [{ platformChatterId: row.chatter.platformChatterId, link }] : [];
  });
  // A ticked bot sits in the closed fold: the count says it, so the button's number never surprises.
  const foldedIds = new Set(folded.map((row) => row.chatter.platformChatterId));
  const tickedFolded = items.filter((item) => foldedIds.has(item.platformChatterId)).length;
  const isBusy = busy !== null;

  const runBatch = (): void => {
    setFailed(null);
    setRowErrors(new Map());
    setBusy({ kind: 'batch' });
    const errors = new Map<string, ShownError>();
    const sendAll = async (): Promise<void> => {
      for (let start = 0; start < items.length; start += BATCH_MAX) {
        const result = await linkTeam(platform, { items: items.slice(start, start + BATCH_MAX) });
        for (const line of result.results) {
          if (!line.ok)
            errors.set(line.platformChatterId, {
              message: `${line.error.message}.`,
              isSessionExpired: false,
            });
        }
        land(result.overview);
      }
      // What went through starts again from the server's state; a refused row keeps the reader's choice.
      setEdits((current) => new Map([...current].filter(([id]) => errors.has(id))));
    };
    sendAll()
      .catch((error: unknown) => {
        setFailed(shownOf(error, 'Rien n’a été relié.'));
      })
      .finally(() => {
        setRowErrors(errors);
        setBusy(null);
      });
  };

  /** A linked row changed: saved at once, as a batch of one. */
  const relink = (row: TeamImportRow, choice: Choice): void => {
    const link = linkOf(choice);
    if (link === null) return;
    const id = row.chatter.platformChatterId;
    const label = chatterName(row.chatter);
    setFailed(null);
    setRowErrors(new Map());
    setBusy({ kind: 'row', id });
    linkTeam(platform, { items: [{ platformChatterId: id, link }] })
      .then(
        (result) => {
          const line = result.results.find((one) => one.platformChatterId === id);
          if (line !== undefined && !line.ok)
            setRowErrors(
              new Map([
                [
                  id,
                  { message: `${label} n’a pas été relié. ${line.error.message}.`, isSessionExpired: false },
                ],
              ]),
            );
          land(result.overview);
        },
        (error: unknown) => {
          setRowErrors(new Map([[id, shownOf(error, `${label} n’a pas été relié.`)]]));
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };

  const dismissal = (row: TeamImportRow, dismissed: boolean): void => {
    const id = row.chatter.platformChatterId;
    const label = chatterName(row.chatter);
    setFailed(null);
    setRowErrors(new Map());
    setBusy({ kind: 'dismissal', id });
    setChatterDismissal(platform, id, dismissed)
      .then(land, (error: unknown) => {
        const lead = dismissed ? `${label} n’a pas été écarté.` : `${label} n’a pas été repris.`;
        setRowErrors(new Map([[id, shownOf(error, lead)]]));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const givable: readonly CreatorSummary[] = bounded
    ? (creators.data ?? []).filter((creator) => ownCreatorIds.includes(creator.id))
    : (creators.data ?? []);

  const rowProps = (row: TeamImportRow) => ({
    row,
    platform: name,
    platformKey: platform,
    team,
    disabled: isBusy,
    error: rowErrors.get(row.chatter.platformChatterId) ?? null,
  });

  const toConfirmRow = (row: TeamImportRow): JSX.Element => (
    <ToConfirmRow
      key={row.chatter.platformChatterId}
      {...rowProps(row)}
      edit={editOf(row)}
      isDismissing={busy?.kind === 'dismissal' && busy.id === row.chatter.platformChatterId}
      onEdit={(patch) => {
        edit(row, patch);
      }}
      onInvite={() => {
        setInviting(row);
      }}
      onDismiss={() => {
        dismissal(row, true);
      }}
    />
  );
  const linkedRow = (row: TeamImportRow): JSX.Element => (
    <LinkedRow
      key={row.chatter.platformChatterId}
      {...rowProps(row)}
      isSaving={busy?.kind === 'row' && busy.id === row.chatter.platformChatterId}
      onChange={(choice) => {
        relink(row, choice);
      }}
    />
  );

  return (
    <Page>
      {header}
      <div className="rv-stack">
        {data.abnormalRead ? (
          <p className="sf-warn sf-list-error">
            La dernière lecture de {name} est anormale : sa liste est revenue vide, ou a perdu plus de la
            moitié de ses comptes d’un coup. Aucun départ n’en est déduit ; les liens restent.
          </p>
        ) : null}
        {data.listError === null ? null : (
          <p className="sf-warn sf-list-error">
            {name} n’a pas renvoyé la liste à jour de son équipe. Les liens déjà posés restent ; rien ne se
            confirme ni ne s’invite tant qu’elle manque. La page la relit à chaque ouverture.
          </p>
        )}

        {data.rows.length === 0 ? (
          <Notice
            title={`Aucun compte de l’équipe ${name} pour l’instant`}
            text={`La liste arrive de ${name} quand la clé de l’API CRM est posée, par le propriétaire, dans Réglages › Ventes.`}
          />
        ) : null}

        {toConfirm.length === 0 &&
        folded.every((row) => row.link !== null || row.dismissedAt !== null) ? null : (
          <Section
            title="À confirmer"
            count={data.newCount === 0 ? null : newcomersLine(data.newCount, name)}
            lede={
              toConfirm.length === 0
                ? null
                : 'Chaque ligne garde la proposition choisie. Coche celles à confirmer ; une invitation se fait ligne par ligne, avec ton mot de passe.'
            }
          >
            {toConfirm.length === 0 ? null : (
              <ul className="sf-import__list" aria-label={`Comptes de ${name} à confirmer`}>
                {toConfirm.map(toConfirmRow)}
              </ul>
            )}
            <div className="sf-import__foot">
              <button
                type="button"
                className="nv-btn nv-btn--neon"
                disabled={items.length === 0 || isBusy}
                onClick={runBatch}
              >
                {busy?.kind === 'batch'
                  ? 'Confirmation…'
                  : items.length === 0
                    ? 'Confirmer la sélection'
                    : `Confirmer la sélection (${String(items.length)})`}
              </button>
              <p className="sv-muted sf-import__count" aria-live="polite">
                {items.length === 0 ? 'Coche au moins un compte.' : tickedCount(items.length, tickedFolded)}
              </p>
            </div>
            {failed === null ? null : (
              <div className="sf-import__msg">
                <p className="sv-notice" role="alert" data-tone="error">
                  {failed.message}
                </p>
                {failed.isSessionExpired ? <SignInAgain /> : null}
              </div>
            )}
          </Section>
        )}

        {linked.length === 0 ? null : (
          <Section
            title="Reliés"
            count={data.removalCount === 0 ? null : removalsLine(data.removalCount, name)}
            warn={data.removalCount > 0}
            lede="La paie lit ces liens. Un retrait sur la plateforme ne coupe rien : le départ se fait par « Changer le statut »."
          >
            <ul className="sf-import__list" aria-label={`Comptes de ${name} reliés`}>
              {linked.map(linkedRow)}
            </ul>
          </Section>
        )}

        {folded.length === 0 ? null : (
          <details className="sf-dismissed nv-plate rv-fold">
            <summary className="sf-dismissed__title">
              Bots et comptes écartés <span className="sf-faint">{folded.length}</span>
            </summary>
            <ul className="sf-import__list">
              {folded.map((row) =>
                row.dismissedAt !== null ? (
                  <DismissedRow
                    key={row.chatter.platformChatterId}
                    {...rowProps(row)}
                    isTaking={busy?.kind === 'dismissal' && busy.id === row.chatter.platformChatterId}
                    onTake={() => {
                      dismissal(row, false);
                    }}
                  />
                ) : row.link === null ? (
                  toConfirmRow(row)
                ) : (
                  linkedRow(row)
                ),
              )}
            </ul>
          </details>
        )}
      </div>

      {inviting === null ? null : (
        <AddMemberPanel
          presets={presets.data ?? []}
          creators={givable}
          invite={{ platform, row: inviting, bounded }}
          onClose={(created) => {
            setInviting(null);
            if (created !== null) {
              void client.invalidateQueries({ queryKey: MEMBERS_KEY });
              onOpenMember(created.id);
            }
          }}
        />
      )}
    </Page>
  );
}

function Section({
  title,
  count,
  warn = false,
  lede,
  children,
}: {
  title: string;
  count: string | null;
  warn?: boolean;
  lede: string | null;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  return (
    <section className="nv-plate sf-links sf-import" aria-labelledby={id}>
      <header className="sf-links__head">
        <h2 id={id} className="sf-links__title">
          {title}
        </h2>
        {count === null ? null : (
          <p className={warn ? 'sf-warn rv-count' : 'sv-muted rv-count'} role="status">
            {count}
          </p>
        )}
        {lede === null ? null : <p className="sv-muted">{lede}</p>}
      </header>
      {children}
    </section>
  );
}

interface RowProps {
  row: TeamImportRow;
  /** The platform's name, as the rows say it. */
  platform: string;
  platformKey: Platform;
  team: readonly TeamMember[];
  disabled: boolean;
  error: ShownError | null;
}

function Face({ row }: { row: TeamImportRow }): JSX.Element {
  return (
    <span className="sf-imp__face" aria-hidden="true">
      {initialsOf(chatterName(row.chatter))}
    </span>
  );
}

/** The account: its name, its e-mail or « Prestataire », its models, and what the server says of it. */
function Who({
  row,
  platform,
  platformKey,
  team,
  note,
}: Pick<RowProps, 'row' | 'platform' | 'platformKey' | 'team'> & {
  /** A line under the account, where the reader has no gesture on the row (his own account). */
  note?: string | undefined;
}): JSX.Element {
  const models = modelsLine(row, platform);
  const gap = row.link?.kind === 'member' ? gapLine(row, platform) : null;
  const removed = removedLine(row, platform);
  const member = row.removal === null ? undefined : team.find((one) => one.id === row.removal?.memberId);
  return (
    <div className="sf-imp__who">
      <span className="sf-imp__name">{chatterName(row.chatter)}</span>
      <span className="sf-imp__meta">
        {row.chatter.isExternal ? 'Prestataire' : (row.chatter.email ?? 'Sans e-mail')}
        {row.chatter.isBot ? ' · Bot d’une clé d’API' : null}
      </span>
      {models === null ? null : <span className="sf-imp__meta">{models}</span>}
      {gap === null ? null : <span className="sf-imp__meta">{gap}</span>}
      {removed === null ? null : <span className="sf-imp__meta">{removed}</span>}
      {row.removal === null ? null : (
        <span className="sf-imp__meta rv-warn">
          {removalLine(
            { ...row.removal, platform: platformKey, platformChatterId: row.chatter.platformChatterId },
            member?.status ?? 'active',
          )}
          .
        </span>
      )}
      {note === undefined ? null : <span className="sf-imp__meta">{note}</span>}
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

function ToConfirmRow({
  row,
  platform,
  platformKey,
  team,
  disabled,
  error,
  edit,
  isDismissing,
  onEdit,
  onInvite,
  onDismiss,
}: RowProps & {
  edit: Edit;
  isDismissing: boolean;
  onEdit: (patch: Partial<Edit>) => void;
  onInvite: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const label = chatterName(row.chatter);
  const options = optionsOf(row, team);
  const why = edit.choice === choiceOf(row.suggestion) ? matchLine(row.suggestion) : null;
  const isInvite = edit.choice === 'invite';
  const canAct = row.actions.length > 0;
  return (
    <li
      className={canAct ? (isInvite ? 'sf-imp rv-row rv-inviting' : 'sf-imp rv-row') : 'sf-imp rv-row rv-own'}
    >
      {canAct && !isInvite ? (
        <input
          type="checkbox"
          className="nv-check"
          aria-label={`Confirmer ${label}`}
          checked={edit.ticked}
          disabled={disabled}
          onChange={(event) => {
            onEdit({ ticked: event.target.checked });
          }}
        />
      ) : (
        <span className="rv-tick-space" aria-hidden="true" />
      )}
      <Face row={row} />
      <Who
        row={row}
        platform={platform}
        platformKey={platformKey}
        team={team}
        note={canAct ? undefined : 'Ton propre compte : seul le propriétaire le relie.'}
      />
      {canAct ? (
        <div className="sf-imp__act">
          <Select
            className="sf-select"
            ariaLabel={`Que faire de ${label}`}
            value={edit.choice}
            disabled={disabled}
            options={options}
            onChange={(choice) => {
              onEdit({ choice, ticked: choice !== 'invite' });
            }}
          />
          {why === null ? null : <span className="sf-imp__why">{why}</span>}
        </div>
      ) : null}
      {canAct ? (
        <div className="sf-imp__end rv-end">
          {isInvite ? (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              aria-label={`Inviter ${label}`}
              disabled={disabled}
              onClick={onInvite}
            >
              Inviter
            </button>
          ) : null}
          {row.actions.includes('dismiss') ? (
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              aria-label={`Écarter ${label}`}
              disabled={disabled}
              onClick={onDismiss}
            >
              {isDismissing ? 'Écartement…' : 'Écarter'}
            </button>
          ) : null}
        </div>
      ) : null}
      {error === null ? null : <RowError error={error} />}
    </li>
  );
}

function LinkedRow({
  row,
  platform,
  platformKey,
  team,
  disabled,
  error,
  isSaving,
  onChange,
}: RowProps & { isSaving: boolean; onChange: (choice: Choice) => void }): JSX.Element {
  const label = chatterName(row.chatter);
  // Changing a link never invites: an account already linked keeps its member, or moves to another one.
  const options = optionsOf(row, team).filter((option) => option.value !== 'invite');
  const isOwn = row.actions.length === 0;
  return (
    <li className={isOwn ? 'sf-imp rv-linked rv-own' : 'sf-imp rv-linked'}>
      <Face row={row} />
      <Who
        row={row}
        platform={platform}
        platformKey={platformKey}
        team={team}
        note={
          isOwn
            ? `Relié : ${linkLabel(row)}. Ton propre compte : seul le propriétaire change son lien.`
            : undefined
        }
      />
      {isOwn ? null : (
        <div className="sf-imp__act">
          <Select
            className="sf-select"
            ariaLabel={`Lien de ${label}`}
            value={linkedChoiceOf(row)}
            disabled={disabled}
            options={options}
            onChange={(choice) => {
              if (choice !== linkedChoiceOf(row)) onChange(choice);
            }}
          />
          {isSaving ? <span className="sf-imp__why">Enregistrement…</span> : null}
        </div>
      )}
      {error === null ? null : <RowError error={error} />}
    </li>
  );
}

function DismissedRow({
  row,
  platform,
  platformKey,
  team,
  disabled,
  error,
  isTaking,
  onTake,
}: RowProps & { isTaking: boolean; onTake: () => void }): JSX.Element {
  const label = chatterName(row.chatter);
  return (
    <li className="sf-imp sf-imp--dismissed">
      <Face row={row} />
      <Who row={row} platform={platform} platformKey={platformKey} team={team} />
      <button
        type="button"
        className="nv-btn nv-btn--soft nv-btn--sm sf-imp__end"
        aria-label={`Reprendre ${label}`}
        disabled={disabled}
        onClick={onTake}
      >
        {isTaking ? 'Reprise…' : 'Reprendre'}
      </button>
      {error === null ? null : <RowError error={error} />}
    </li>
  );
}
