import type { CommissionPreset, CreatorSummary, TeamMember, TeamRole } from '@nirvana/contracts';
import { placeSegmentThumb } from '@nirvana/design-system';
import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { AddMemberPanel } from './AddMemberPanel';
import { MemberSheet } from './MemberSheet';
import { TeamNav } from './TeamNav';
import { useMembers, usePresets } from './api';
import { creatorNames, invitationState, listMembers, rateLine, TAB_LABELS, teamSummary } from './model';
import { Avatar, Notice, StatusPill, Unread } from './parts';
import './team.css';

import { useCreators } from '@/creators/api';
import { countryFlag, countryName } from '@/lib/country';
import { Page, PageHeader, Panel } from '@/shell/layout';

const TABS: readonly TeamRole[] = ['chatter', 'manager'];

/**
 * Équipe › Membres (EQ-01, ADR 0024): the agency's chatters and managers, a tab each, searched by name; a member
 * opens on the right with his creators, his rate, his first access and the internal notes. The owner adds a member
 * from here and shares his invitation link (EQ-10); an active manager reads the team.
 */
export function MembersPage({
  tab,
  selected,
  canManage,
  viewerId,
  onTab,
  onSelect,
}: {
  tab: TeamRole;
  /** The member open on the right (`/equipe/membres?membre=<id>`), or null for the list alone. */
  selected: string | null;
  /** The owner adds members, makes their links and sees their rates; a manager reads. */
  canManage: boolean;
  /** The account reading: a manager's own record shows no notes, he never reads those about him. */
  viewerId: string;
  onTab: (tab: TeamRole) => void;
  onSelect: (memberId: string | null) => void;
}): JSX.Element {
  const members = useMembers();
  const presets = usePresets();
  const creators = useCreators();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const all = members.data ?? [];
  const lists = listMembers(all, tab, query);
  // A search that only finds members who left opens their fold, so the list and the fold do not contradict.
  const searching = query.trim() !== '';
  const onlyGone = searching && lists.current.length === 0 && lists.gone.length > 0;
  const open = all.find((member) => member.id === selected) ?? null;
  const summary = teamSummary(all, new Date());
  const known = presets.data ?? [];
  const names = creators.data ?? [];

  const add = canManage ? (
    <button
      type="button"
      className="nv-btn nv-btn--neon"
      onClick={() => {
        setAdding(true);
      }}
    >
      Ajouter un membre
    </button>
  ) : undefined;

  return (
    <Page className={open === null ? '' : 'tm-is-reading'}>
      <PageHeader
        title="Équipe"
        lead={summary ?? 'Les chatteurs et les managers de l’agence, leurs créatrices et leur taux.'}
        actions={
          <>
            <TeamNav />
            {all.length === 0 ? null : add}
          </>
        }
      />
      {members.isError ? (
        <Unread
          text="Le serveur ne répond pas : l’équipe n’a pas pu être lue."
          onRetry={() => {
            void members.refetch();
          }}
        />
      ) : members.isPending ? (
        <Panel className="tm-panel">
          <div className="tm-skeleton" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </Panel>
      ) : all.length === 0 ? (
        canManage ? (
          <Notice
            title="Ton équipe commence ici"
            text="Ajoute un chatteur ou un manager : tu lui envoies ensuite son lien d’invitation, et il choisit son mot de passe."
          >
            {add}
          </Notice>
        ) : (
          <Notice
            title="Personne dans l’équipe pour l’instant"
            text="Les membres ajoutés par l’agence arrivent ici."
          />
        )
      ) : (
        <div className="tm-layout">
          <div className="tm-side">
            <div className="tm-tools">
              <label className="tm-search nv-glass nv-glass--thin">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" />
                  <path d="m10.5 10.5 3 3" />
                </svg>
                <span className="sr-only">Rechercher un membre</span>
                <input
                  type="search"
                  value={query}
                  placeholder="Rechercher"
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                />
              </label>
              <Tabs tab={tab} counts={lists.counts} onTab={onTab} />
            </div>
            <Panel className="tm-panel">
              {lists.current.length === 0 ? (
                <p className="tm-none nv-swap">
                  {query.trim() === ''
                    ? tab === 'manager'
                      ? 'Aucun manager pour l’instant.'
                      : 'Aucun chatteur pour l’instant.'
                    : onlyGone
                      ? `Aucun membre actuel ne répond à « ${query.trim()} ». Parmi les partis, ci-dessous :`
                      : `Personne ne répond à « ${query.trim()} ».`}
                </p>
              ) : (
                <ul className="nv-list tm-list" aria-label={TAB_LABELS[tab]}>
                  {lists.current.map((member) => (
                    <Row
                      key={member.id}
                      member={member}
                      presets={known}
                      creators={names}
                      isOpen={member.id === selected}
                      onOpen={() => {
                        onSelect(member.id);
                      }}
                    />
                  ))}
                </ul>
              )}
            </Panel>
            {lists.gone.length === 0 ? null : (
              <details className="nv-disclosure nv-plate tm-gone" open={onlyGone || undefined}>
                <summary>
                  <span className="nv-disclosure__title">Partis</span>
                  <span className="nv-disclosure__sum">{lists.gone.length}</span>
                </summary>
                <div className="nv-disclosure__body">
                  <ul className="nv-list tm-list" aria-label="Partis">
                    {lists.gone.map((member) => (
                      <Row
                        key={member.id}
                        member={member}
                        presets={known}
                        creators={names}
                        isOpen={member.id === selected}
                        onOpen={() => {
                          onSelect(member.id);
                        }}
                      />
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </div>
          {open === null ? (
            <div className="tm-pick nv-enter">
              <p className="tm-pick__title">Aucune fiche ouverte</p>
              <p className="tm-pick__text">
                Choisis un membre dans la liste pour voir son taux, ses créatrices et ses notes.
              </p>
            </div>
          ) : (
            <MemberSheet
              key={open.id}
              member={open}
              presets={known}
              creators={names}
              canManage={canManage}
              isSelf={open.userId === viewerId}
              onClose={() => {
                onSelect(null);
              }}
            />
          )}
        </div>
      )}
      {adding ? (
        <AddMemberPanel
          presets={known}
          creators={names}
          onClose={(created) => {
            setAdding(false);
            if (created !== null) {
              onTab(created.teamRole);
              onSelect(created.id);
            }
          }}
        />
      ) : null}
    </Page>
  );
}

function Row({
  member,
  presets,
  creators,
  isOpen,
  onOpen,
}: {
  member: TeamMember;
  presets: readonly CommissionPreset[];
  creators: readonly CreatorSummary[];
  isOpen: boolean;
  onOpen: () => void;
}): JSX.Element {
  const theirs = creatorNames(member, creators);
  // Still to choose a password: one pill, « Invité » or « Lien expiré », in place of the status (EQ-05, EQ-06). A reset
  // link out for one who has a password is not an invitation (the summary says the same).
  const access = member.invitationPending ? invitationState(member, new Date()).kind : null;
  return (
    <li className="nv-enter">
      <button
        type="button"
        className="nv-convo tm-row"
        aria-current={isOpen ? 'true' : undefined}
        onClick={onOpen}
      >
        <Avatar member={member} />
        <span className="nv-convo__main">
          <span className="nv-convo__name tm-name">{member.displayName}</span>
          <span className="nv-convo__preview">
            <span aria-hidden="true">{countryFlag(member.country)} </span>
            {countryName(member.country)} · {rateLine(member.commission, presets)}
            {theirs.length === 0 ? null : ` · ${theirs.join(', ')}`}
          </span>
        </span>
        {/* « Actif » is the rule, not news: a pill only for what is not (EQ-05). */}
        <span className="nv-convo__side">
          {access === 'expired' ? (
            <span className="tm-invited tm-invited--expired">Lien expiré</span>
          ) : access !== null ? (
            <span className="tm-invited">Invité</span>
          ) : member.status === 'active' ? null : (
            <StatusPill member={member} />
          )}
        </span>
      </button>
    </li>
  );
}

const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Chatteurs | Managers: a segmented control whose thumb slides; the arrow keys move it. */
function Tabs({
  tab,
  counts,
  onTab,
}: {
  tab: TeamRole;
  counts: Readonly<Record<TeamRole, number>>;
  onTab: (tab: TeamRole) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const index = TABS.indexOf(tab);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    placeSegmentThumb(element, index, TABS.length, placed.current ? (thumb.current ?? undefined) : undefined);
    placed.current = true;
  }, [index]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length] ?? tab;
    ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    onTab(next);
  };

  return (
    <div
      className="nv-seg nv-glass nv-glass--thin tm-seg"
      role="radiogroup"
      aria-label="Rôle"
      ref={ref}
      onKeyDown={onKeyDown}
    >
      <span className="nv-seg__thumb nv-glass nv-glass--thin" ref={thumb} aria-hidden="true" />
      {TABS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          data-tab={option}
          className="nv-seg__opt"
          aria-checked={option === tab}
          tabIndex={option === tab ? 0 : -1}
          onClick={() => {
            onTab(option);
          }}
        >
          {TAB_LABELS[option]}
          <span className="tm-count">{counts[option]}</span>
        </button>
      ))}
    </div>
  );
}
