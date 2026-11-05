import type { JSX } from 'react';

import { MY_AWAY, type MyAwayStatus } from './model';
import './scheduling.css';

import { Panel } from '@/shell/layout';

/**
 * A member away from the team (suspended, on leave, …) reads it first and once (CHAT-09), in place of a shift or a
 * list he no longer has: the server gives him none of his creators until he is back at work.
 */
export function MyAwayCard({ status }: { status: MyAwayStatus }): JSX.Element {
  const words = MY_AWAY[status];
  return (
    <Panel className="sc-off sc-off--away nv-enter">
      <div className="sc-off__in" role="status">
        <span className="sc-off__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M10 9v6M14 9v6" />
          </svg>
        </span>
        <div className="sc-off__text">
          <h2 className="sc-off__title">{words.title}</h2>
          <p className="sc-off__lead">{words.text}</p>
        </div>
      </div>
    </Panel>
  );
}
