import type {
  CommissionPreset,
  CreatorSummary,
  TeamMember,
  TeamPlatformRemoval,
  TeamRole,
} from '@impera/contracts';
import { placeSegmentThumb } from '@impera/design-system';
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type JSX, type KeyboardEvent } from 'react';

import { AddMemberPanel } from './AddMemberPanel';
import { MemberSheet } from './MemberSheet';
import { TeamNav } from './TeamNav';
import { useMembers, usePlatformRemovals, usePresets } from './api';
import { creatorNames, invitationState, listMembers, rateLine, removalPill, TAB_LABELS } from './model';
import { Avatar, Notice, StatusPill } from './parts';
import './team.css';

import { useCreators } from '@/creators/api';
import { countryName } from '@/lib/country';
import { TeamArt } from '@/shell/art/EmptyArt';
import { Page, PageHeader, Panel } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';
import { Failure } from '@/shell/states';

const TABS: readonly TeamRole[] = ['chatter', 'manager'];

/** Wide enough for the list and a member's sheet side by side with room to spare: the first member opens there. */
const WIDE = '(min-width: 1280px)';

function subscribeWide(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(WIDE);
  // An old engine, or a stand-in, without the listener: read once, never followed.
  if (typeof query.addEventListener !== 'function') return () => undefined;
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

const isWide = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches;

/** Whether the screen is wide (1280 px and more), kept up to date as the window changes. */
const useWide = (): boolean => useSyncExternalStore(subscribeWide, isWide, () => false);

/**
 * Équipe › Membres (EQ-01, ADR 0024): the agency's chatters and managers, a tab each, searched by name; a member
 * opens on the right with his creators, his rate, his first access and the internal notes. The owner adds a member
 * from here and shares his invitation link (EQ-10); an active manager reads the team.
 */
export function MembersPage({
  tab,
  selected,
  canManage,
  seesSetup = canManage,
  viewerId,
  onTab,
  onSelect,
}: {
  tab: TeamRole;
  /** The member open on the right (`/equipe/membres?membre=<id>`), or null for the list alone. */
  selected: string | null;
  /** The owner adds members, makes their links and sees their rates; a manager reads. */
  canManage: boolean;
  /** « Mise en route »: the owner's for everyone, an active manager's for the chatters (« ok manager mise en route »). */
  seesSetup?: boolean;
  /** The account reading: a manager's own record shows no notes, he never reads those about him. */
  viewerId: string;
  onTab: (tab: TeamRole) => void;
  onSelect: (memberId: string | null) => void;
}): JSX.Element {
  const members = useMembers();
  const presets = usePresets();
  const creators = useCreators();
  // ADR 0076 § 5: who is still here though his platform account was removed; nothing said while it cannot be read,
  // nor for one who left, even before the list is read again.
  const removals = usePlatformRemovals();
  const removalsOf = (member: TeamMember): TeamPlatformRemoval[] =>
    member.status === 'left' ? [] : (removals.data ?? []).filter((removal) => removal.memberId === member.id);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const all = members.data ?? [];
  const lists = listMembers(all, tab, query);
  // A search that only finds members who left opens their fold, so the list and the fold do not contradict.
  const searching = query.trim() !== '';
  const onlyGone = searching && lists.current.length === 0 && lists.gone.length > 0;
  // Nothing chosen on a wide screen: the first member of the list opens rather than a column that says « nothing »
  // (recette visuelle 16/11, GES-21). The address stays the list's; closing that sheet leaves the column to its hint.
  const wide = useWide();
  const [dismissed, setDismissed] = useState(false);
  const first = selected === null && wide && !dismissed ? (lists.current[0] ?? null) : null;
  const open = all.find((member) => member.id === selected) ?? first;
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
        eyebrow="Équipe"
        title={screenLabel('/equipe/membres')}
        // A sentence, as on the other tabs: who is active is counted in the capsule (GES-21).
        lead="Qui travaille pour l’agence, à quel taux, sur quels comptes."
        tabs={<TeamNav />}
        {...(all.length === 0 || add === undefined ? {} : { actions: add })}
      />
      {members.isError ? (
        <Failure
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
            art={<TeamArt />}
            title="Ton équipe commence ici"
            text="Ajoute un chatteur ou un manager : tu lui envoies ensuite son lien d’invitation, et il choisit son mot de passe."
          >
            {add}
          </Notice>
        ) : (
          <Notice
            art={<TeamArt />}
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
                      removals={removalsOf(member)}
                      isOpen={member.id === open?.id}
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
                        removals={removalsOf(member)}
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
              removals={removalsOf(open)}
              canManage={canManage}
              seesSetup={seesSetup}
              isSelf={open.userId === viewerId}
              onClose={() => {
                // Closed by hand, a sheet leaves the column to its hint: the first member does not come back in it.
                setDismissed(true);
                if (selected !== null) onSelect(null);
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
  removals,
  isOpen,
  onOpen,
}: {
  member: TeamMember;
  presets: readonly CommissionPreset[];
  creators: readonly CreatorSummary[];
  /** His accounts removed from a platform while he is still here (ADR 0076 § 5). */
  removals: readonly TeamPlatformRemoval[];
  isOpen: boolean;
  onOpen: () => void;
}): JSX.Element {
  const theirs = creatorNames(member, creators);
  // Still to choose a password: one pill, « Invité » or « Lien expiré », in place of the status (EQ-05, EQ-06). A reset
  // link out for one who has a password is not an invitation (the summary says the same).
  const access = member.invitationPending ? invitationState(member, new Date()).kind : null;
  const status =
    access === 'expired' ? (
      <span className="tm-invited tm-invited--expired">Lien expiré</span>
    ) : access !== null ? (
      <span className="tm-invited">Invitation envoyée</span>
    ) : member.status === 'active' ? null : (
      <StatusPill member={member} />
    );
  const pills =
    removals.length === 0 && status === null ? null : (
      <>
        {/* Amber, beside his status: removed on the platform, nothing is turned off here (ADR 0076 § 5). */}
        {removals.map((removal) => (
          <span
            key={`${removal.platform}:${removal.platformChatterId}`}
            className="tm-invited tm-invited--warn"
          >
            {removalPill(removal)}
          </span>
        ))}
        {status}
      </>
    );
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
          {/* « Actif » is the rule, not news: a pill only for what is not (EQ-05), under his name, so that the line
              of his creators keeps the row's width (recette visuelle 16/11, GES-21). */}
          {pills === null ? null : <span className="tm-row__pills">{pills}</span>}
          {/* The country in words: a flag is an emoji, read « FR » on some systems (GES-21). */}
          <span className="nv-convo__preview">
            {countryName(member.country)} · {rateLine(member.commission, presets)}
            {theirs.length === 0 ? null : ` · ${theirs.join(', ')}`}
          </span>
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
