import type { Announcement } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { ANNOUNCEMENTS_KEY, markRead, useAnnouncements } from '@/screens/team/announcements-api';
import { audienceOf, whenWritten } from '@/screens/team/announcements-view';
import '@/screens/team/announcements.css';
import { Panel } from '@/shell/layout';

/**
 * Annonces in Aujourd'hui (EQ-12, ADR 0024): what the owner or a manager wrote to him and he has not said « J’ai lu » to,
 * the newest first. Nothing at all once all are read: the card never stands empty. One said « Lu » stays, ticked,
 * until he leaves the page, so the gesture is seen to land.
 */
export function AnnouncementsCard({ zone, today }: { zone: string; today: string }): JSX.Element | null {
  const announcements = useAnnouncements();
  // Those said « Lu » on this visit: kept on the card, ticked.
  const [justRead, setJustRead] = useState<ReadonlySet<string>>(new Set());
  const shown = (announcements.data ?? []).filter(
    (one) => !one.mine && (one.readAt === null || justRead.has(one.id)),
  );
  if (shown.length === 0) return null;
  return (
    <Panel className="an-card nv-enter" title="Annonces">
      <ul className="an-list">
        {shown.map((one) => (
          <Item
            key={one.id}
            announcement={one}
            zone={zone}
            today={today}
            onRead={() => {
              setJustRead((before) => new Set(before).add(one.id));
            }}
          />
        ))}
      </ul>
    </Panel>
  );
}

function Item({
  announcement,
  zone,
  today,
  onRead,
}: {
  announcement: Announcement;
  zone: string;
  today: string;
  onRead: () => void;
}): JSX.Element {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const read = announcement.readAt !== null;
  const say = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const sent = await markRead(announcement.id);
    setBusy(false);
    if (!sent.ok) {
      setProblem(sent.said);
      return;
    }
    onRead();
    client.setQueryData<Announcement[]>(ANNOUNCEMENTS_KEY, (before) =>
      before?.map((one) => (one.id === announcement.id ? { ...one, readAt: sent.value.readAt } : one)),
    );
  };
  return (
    <li className={read ? 'an-item is-read' : 'an-item'}>
      <p className="an-item__meta">
        <b>{announcement.authorName}</b>
        <span>
          {audienceOf(announcement)} · {whenWritten(announcement.createdAt, zone, today)}
        </span>
      </p>
      <p className="an-item__body">{announcement.body}</p>
      <div className="an-item__foot">
        {read ? (
          <span className="an-read nv-swap" role="status">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m3.5 8.5 3 3 6-7" />
            </svg>
            Lu
          </span>
        ) : (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void say();
            }}
          >
            J’ai lu
          </button>
        )}
        {problem === null ? null : (
          <p className="an-warn nv-swap" role="alert">
            {problem}
          </p>
        )}
      </div>
    </li>
  );
}
