import type { PlatformAccountId } from '@impera/contracts';

import { h } from '../../lib/dom';
import type { RevealAccounts } from '../../lib/watch/protocol';

import {
  button,
  hourOf,
  linkForm,
  notice,
  pill,
  text,
  type WatchActions,
  type WatchNotice,
} from './watch-view';

/**
 * The owner's « Sync » on a Reveal tab (P2-01, reveal-connector-spec.md § 2): one line per Reveal account of the CRM,
 * with its session's state and a button that sends the session of the open tab. Pure: main.ts does the browser side.
 * Never shown to a manager, a chatter or a creator: the server refuses their link anyway.
 */

export interface SyncView {
  readonly accounts: RevealAccounts;
  readonly notice: WatchNotice | null;
  readonly busy: boolean;
  /** What was typed in the link field, kept across a redraw. */
  readonly draft: string;
  readonly now: Date;
}

export interface SyncActions extends Pick<WatchActions, 'link' | 'openSecurity'> {
  readonly sync: (accountId: PlatformAccountId) => void;
  readonly retry: () => void;
}

type Account = RevealAccounts['accounts'][number];

/** « aujourd’hui à 14 h 05 », « le 9/11 à 8 h 30 ». */
export function whenOf(at: Date, now: Date): string {
  const sameDay = at.toDateString() === now.toDateString();
  const day = sameDay ? 'aujourd’hui' : `le ${String(at.getDate())}/${String(at.getMonth() + 1)}`;
  return `${day} à ${hourOf(at)}`;
}

function stateLine(account: Account, now: Date): HTMLElement {
  const at = account.sessionUpdatedAt === null ? null : whenOf(new Date(account.sessionUpdatedAt), now);
  switch (account.sessionState) {
    case 'none':
      return h('p', { class: 'pp-hint pp-hint--amber' }, 'Jamais synchronisée.');
    case 'expired':
      return h('p', { class: 'pp-hint pp-hint--amber' }, 'Session expirée.');
    case 'warning':
      return h('p', { class: 'pp-hint pp-hint--amber' }, 'Session bientôt expirée.');
    case 'valid':
      return h('p', { class: 'pp-hint' }, at === null ? 'Session valide.' : `Session valide, envoyée ${at}.`);
  }
}

function accountRow(account: Account, view: SyncView, actions: SyncActions): HTMLElement {
  const urgent = account.sessionState !== 'valid';
  return h(
    'div',
    { class: 'pp-sync__account' },
    h(
      'div',
      { class: 'pp-sync__who' },
      h('span', { class: 'pp-sync__name' }, account.creatorName),
      h('span', { class: 'pp-sync__handle' }, `@${account.handle}`),
      stateLine(account, view.now),
    ),
    button(
      'Synchroniser',
      () => {
        actions.sync(account.id);
      },
      urgent ? 'neon' : 'soft',
      { busy: view.busy },
    ),
  );
}

function syncBody(view: SyncView, actions: SyncActions): readonly HTMLElement[] {
  const { state, accounts } = view.accounts;
  switch (state) {
    case 'none':
    case 'revoked':
      return linkForm(
        { draft: view.draft, notice: view.notice, busy: view.busy, revoked: state === 'revoked' },
        actions,
        'Pour synchroniser, colle une fois le code de « Relier l’extension ».',
      );
    case 'not-owner':
      return [];
    case 'unreachable':
      return [
        h('p', { class: 'pp-hint pp-hint--amber' }, 'Le CRM ne répond pas : réessaie dans un instant.'),
        button('Réessayer', actions.retry, 'plain'),
      ];
    case 'ok':
      return accounts.length === 0
        ? [text('Aucun compte Reveal dans le CRM : ajoute-le d’abord dans les réglages des connecteurs.')]
        : [
            ...accounts.map((account) => accountRow(account, view, actions)),
            ...[notice(view.notice)].filter((line): line is HTMLElement => line !== null),
            h(
              'p',
              { class: 'pp-hint' },
              'Garde la messagerie Reveal ouverte : la session est lue, envoyée au CRM, puis oubliée.',
            ),
          ];
  }
}

/** The card's action is the screen's one neon: a link to paste, or an account whose session is missing or ending. */
export function syncWanted(view: SyncView | null): boolean {
  if (view === null) return false;
  const { state, accounts } = view.accounts;
  return (
    state === 'none' ||
    state === 'revoked' ||
    (state === 'ok' && accounts.some((account) => account.sessionState !== 'valid'))
  );
}

export function syncCard(view: SyncView, actions: SyncActions): HTMLElement | null {
  if (view.accounts.state === 'not-owner') return null;
  const late = view.accounts.accounts.some((account) => account.sessionState !== 'valid');
  const status =
    view.accounts.state !== 'ok'
      ? pill('awaiting-approval', 'À relier')
      : late
        ? pill('awaiting-approval', 'À synchroniser')
        : view.accounts.accounts.length === 0
          ? null
          : pill('sent', 'À jour');
  return h(
    'section',
    { class: 'pp-sync', 'aria-labelledby': 'sync-title' },
    h(
      'header',
      { class: 'pp-sync__head' },
      h('span', { class: 'pp-sync__title', id: 'sync-title' }, 'Session du connecteur'),
      status,
    ),
    ...syncBody(view, actions),
  );
}
