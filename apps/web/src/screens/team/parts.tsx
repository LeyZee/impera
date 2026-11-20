import type { TeamMember } from '@impera/contracts';
import type { JSX, ReactNode } from 'react';

import { STATUS_LABELS, STATUS_TONES } from './model';

import '@/scheduling/exchanges.css';
import { initialsOf } from '@/settings/sales-feed/importing';
import { Panel } from '@/shell/layout';
import { Empty } from '@/shell/states';

/** The pieces the list, the sheet and the add panel share. */

/**
 * The member's initials, two letters as Équipe › Comptes Reveal writes them (« Chatteur Un » → « CU »), on his planning colour
 * once he has one: one letter made every « Chatteur … » the same « C » (recette visuelle 16/11, GES-21).
 */
export function Avatar({ member, large = false }: { member: TeamMember; large?: boolean }): JSX.Element {
  return (
    <span
      className={large ? 'nv-avatar tm-avatar' : 'nv-avatar nv-avatar--sm tm-avatar'}
      style={member.color === null ? undefined : { '--tm-color': member.color }}
      data-color={member.color === null ? undefined : 'true'}
      aria-hidden="true"
    >
      {initialsOf(member.displayName)}
    </span>
  );
}

export function StatusPill({ member }: { member: TeamMember }): JSX.Element {
  return (
    <span className={`nv-status tm-status tm-status--${STATUS_TONES[member.status]}`}>
      <span className="nv-status__dot" />
      {STATUS_LABELS[member.status]}
    </span>
  );
}

export function Notice({
  title,
  text,
  art,
  children,
}: {
  title: string;
  text: string;
  /** The picture of the subject, when the whole screen is empty. */
  art?: JSX.Element;
  children?: ReactNode;
}): JSX.Element {
  return (
    <Empty plate title={title} action={children} {...(art === undefined ? {} : { art })}>
      {text}
    </Empty>
  );
}

/**
 * What could not be read, said as Rapports says it (EQ-22): one amber line and « Réessayer », the same on Planning,
 * Membres and Rapports.
 */
export function Unread({ text, onRetry }: { text: string; onRetry: () => void }): JSX.Element {
  return (
    <Panel className="tm-unread">
      <div className="sc-empty">
        <p className="tm-warn">{text}</p>
        <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onRetry}>
          Réessayer
        </button>
      </div>
    </Panel>
  );
}
