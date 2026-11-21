import { ANNOUNCEMENT_BODY_MAX, type Announcement, type CreatorId } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { TeamNav } from './TeamNav';
import {
  ANNOUNCEMENTS_KEY,
  createAnnouncement,
  useAnnouncements,
  useReaders,
  withdrawAnnouncement,
} from './announcements-api';
import { audienceOf, readsLine, whenWritten } from './announcements-view';
import './announcements.css';

import { useCreators } from '@/creators/api';
import { useGrowingArea } from '@/lib/growing-area';
import { clockAt, dayOf, readerZone } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Page, PageHeader, Panel } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';
import { Failure } from '@/shell/states';

/** Past this many characters, the card says how many are left. */
const COUNT_FROM = ANNOUNCEMENT_BODY_MAX - 200;

/**
 * Équipe › Annonces (EQ-12, ADR 0024): the owner or an active manager writes to the whole team or to the members of
 * one creator (a manager, of his own list: the creators he reads), and sees, for each announcement, who has said « Lu ».
 * Its author or the owner withdraws it; it is never edited. Never fan data: the composer says so.
 */
export function AnnouncementsPage({ owner }: { owner: boolean }): JSX.Element {
  const announcements = useAnnouncements();
  const zone = readerZone();
  const today = dayOf(useNow(), zone);
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Équipe"
        title={screenLabel('/equipe/annonces')}
        lead="Un mot à toute l’équipe ou aux membres d’une créatrice, lu dans leur Aujourd’hui."
        tabs={<TeamNav />}
      />
      {/* The page's body is one row: its two cards keep their own height, « Envoyées » right under the composer. */}
      <div className="an-page">
        <Composer />
        {announcements.isError ? (
          <Failure
            onRetry={() => {
              void announcements.refetch();
            }}
          />
        ) : announcements.data === undefined ? null : (
          <Panel className="an-card nv-enter" title="Envoyées">
            {announcements.data.length === 0 ? (
              <p className="an-none">Aucune annonce pour l’instant.</p>
            ) : (
              <ul className="an-list">
                {announcements.data.map((one) => (
                  <Sent key={one.id} announcement={one} zone={zone} today={today} owner={owner} />
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </Page>
  );
}

function Composer(): JSX.Element {
  const client = useQueryClient();
  const creators = useCreators();
  const [to, setTo] = useState<CreatorId | null>(null);
  const [draft, setDraft] = useState('');
  const area = useGrowingArea(draft);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const hint = useId();
  const audiences: readonly { readonly id: CreatorId | null; readonly label: string }[] = [
    { id: null, label: 'Toute l’équipe' },
    ...(creators.data ?? []).map((creator) => ({ id: creator.id, label: creator.displayName })),
  ];
  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (body === '' || busy) return;
    setBusy(true);
    setProblem(null);
    const sent = await createAnnouncement({ body, creatorId: to });
    setBusy(false);
    if (!sent.ok) {
      setProblem(sent.said);
      return;
    }
    setDraft('');
    client.setQueryData<Announcement[]>(ANNOUNCEMENTS_KEY, (before) => [sent.value, ...(before ?? [])]);
  };
  const left = ANNOUNCEMENT_BODY_MAX - draft.length;
  return (
    <Panel className="an-card" title="Nouvelle annonce">
      <form
        className="an-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <p className="nv-eyebrow" aria-hidden="true">
          Pour
        </p>
        <div className="an-chips" role="radiogroup" aria-label="Pour">
          {audiences.map((audience) => (
            <button
              key={audience.id ?? 'team'}
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={to === audience.id}
              onClick={() => {
                setTo(audience.id);
              }}
            >
              {audience.label}
            </button>
          ))}
        </div>
        <textarea
          ref={area}
          className="nv-field__control nv-glass an-input grow-area"
          value={draft}
          rows={3}
          maxLength={ANNOUNCEMENT_BODY_MAX}
          placeholder="Ton message à l’équipe"
          aria-label="Annonce"
          aria-describedby={hint}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <div className="an-compose__foot">
          <p id={hint} className="an-hint">
            {draft.length >= COUNT_FROM
              ? `${String(left)} ${left === 1 ? 'caractère restant' : 'caractères restants'}`
              : 'Jamais de pseudo ni de message de fan.'}
          </p>
          <button
            type="submit"
            className="nv-btn nv-btn--neon nv-btn--sm"
            disabled={draft.trim() === '' || busy}
            aria-busy={busy}
          >
            {busy ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
        {problem === null ? null : (
          <p className="an-warn nv-swap" role="alert">
            {problem}
          </p>
        )}
      </form>
    </Panel>
  );
}

function Sent({
  announcement,
  zone,
  today,
  owner,
}: {
  announcement: Announcement;
  zone: string;
  today: string;
  owner: boolean;
}): JSX.Element {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const list = useId();
  const withdraw = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const sent = await withdrawAnnouncement(announcement.id);
    setBusy(false);
    if (!sent.ok) {
      setProblem(sent.said);
      return;
    }
    client.setQueryData<Announcement[]>(ANNOUNCEMENTS_KEY, (before) =>
      before?.filter((one) => one.id !== announcement.id),
    );
  };
  return (
    <li className="an-item">
      <p className="an-item__meta">
        <b>{announcement.mine ? 'Toi' : announcement.authorName}</b>
        <span>
          {audienceOf(announcement)} · {whenWritten(announcement.createdAt, zone, today)}
        </span>
      </p>
      <p className="an-item__body">{announcement.body}</p>
      <div className="an-item__foot">
        {announcement.reads === null ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm an-reads"
            aria-expanded={open}
            aria-controls={list}
            disabled={announcement.reads.of === 0}
            onClick={() => {
              setOpen((before) => !before);
            }}
          >
            {readsLine(announcement.reads)}
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4.5 6 3.5 3.5L11.5 6" />
            </svg>
          </button>
        )}
        {announcement.mine || owner ? (
          confirming ? (
            <span className="an-confirm nv-swap">
              <span>Elle disparaît d’Aujourd’hui pour tous.</span>
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                disabled={busy}
                aria-busy={busy}
                onClick={() => {
                  void withdraw();
                }}
              >
                Retirer
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Garder
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm an-withdraw"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Retirer
            </button>
          )
        ) : null}
      </div>
      {problem === null ? null : (
        <p className="an-warn nv-swap" role="alert">
          {problem}
        </p>
      )}
      {open ? <Readers id={announcement.id} listId={list} zone={zone} today={today} /> : null}
    </li>
  );
}

/** Each member it is addressed to: those who read it first, with when; the others after, still to read. */
function Readers({
  id,
  listId,
  zone,
  today,
}: {
  id: string;
  listId: string;
  zone: string;
  today: string;
}): JSX.Element {
  const readers = useReaders(id, true);
  if (readers.isError) {
    return (
      <p id={listId} className="an-warn">
        La liste n’a pas pu être lue.
      </p>
    );
  }
  if (readers.data === undefined) {
    return (
      <p id={listId} className="an-hint" aria-busy="true">
        Lecture…
      </p>
    );
  }
  return (
    <ul id={listId} className="an-readers nv-swap">
      {readers.data.map((reader) => (
        <li key={reader.memberId} className={reader.readAt === null ? 'is-waiting' : undefined}>
          <span>{reader.name}</span>
          <span className="nv-num">
            {reader.readAt === null
              ? 'pas encore'
              : dayOf(reader.readAt, zone) === today
                ? `lu à ${clockAt(reader.readAt, zone)}`
                : `lu ${whenWritten(reader.readAt, zone, today)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
