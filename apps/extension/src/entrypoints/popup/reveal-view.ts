import type { PlatformAccountId } from '@impera/contracts';

import { h } from '../../lib/dom';
import type { RevealAccounts, RevealSeen } from '../../lib/watch/protocol';

import { button, card, pill, text } from './card';
import { hourOf, linkForm, notice, type WatchActions, type WatchNotice } from './watch-view';

/**
 * The cards of a Reveal tab (recette du 16/11, EXT-02, 09, 11, 12, V-EXT-05, 09). The copilot, for every member who
 * has the panel, with the « Relier » that counts his gestures; then, for the owner alone, the Reveal session, one line
 * per account (P2-01, reveal-connector-spec.md § 2). Pure: main.ts does the browser side.
 */

/** The link of this extension (ADR 0066 § 7), as the service worker holds it; `unknown` when it did not answer. */
export type LinkState = 'none' | 'linked' | 'revoked' | 'unknown';

export interface CopilotView {
  readonly link: LinkState;
  /** What was typed in the link field, kept across a redraw. */
  readonly draft: string;
  readonly notice: WatchNotice | null;
  readonly busy: boolean;
}

export type CopilotActions = Pick<WatchActions, 'link' | 'openSecurity'>;

/** The session read in the tab, held by the service worker until the owner sends it or not (demande de Sécurité). */
export interface Confirm {
  readonly accountId: PlatformAccountId;
  readonly modelId: string;
  readonly seen: RevealSeen;
}

export interface SyncView {
  readonly accounts: RevealAccounts;
  readonly notice: WatchNotice | null;
  /** The account whose session is on its way, and how far (EXT-19, V-EXT-16); null while nothing is. */
  readonly pending: { readonly accountId: PlatformAccountId; readonly phase: 'reading' | 'sending' } | null;
  readonly confirm: Confirm | null;
  readonly now: Date;
}

export interface SyncActions {
  readonly sync: (accountId: PlatformAccountId) => void;
  readonly send: () => void;
  readonly cancel: () => void;
  readonly retry: () => void;
}

type Account = RevealAccounts['accounts'][number];

/** « le 15/11/2026 à 21 h 39 », the way the CRM writes a day and an hour (recette du 16/11, EXT-26). */
export function whenOf(at: Date): string {
  const day = at.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `le ${day} à ${hourOf(at)}`;
}

/* ---- The copilot ---- */

const COPILOT_TEXT = 'Il s’ouvre sur le côté et suit la conversation ouverte. Rien n’est envoyé d’ici.';

/**
 * The copilot's card. The panel lives beside Reveal (ADR 0086 § 1): « Ouvrir le copilote » is the tab's one action,
 * the neon (EXT-11), unless the owner has a session to send; next to the session card it shrinks to one line (EXT-12).
 */
export function copilotCard(
  view: CopilotView,
  options: { readonly compact: boolean; readonly neon: boolean; readonly index: number },
  openPanel: () => void,
  actions: CopilotActions,
): HTMLElement {
  const unlinked = view.link === 'none' || view.link === 'revoked';
  const open = (wide: boolean): HTMLButtonElement =>
    button('Ouvrir le copilote', openPanel, options.neon ? 'neon' : 'soft', { wide });
  if (options.compact && !unlinked) {
    return card({
      id: 'copilot',
      icon: 'message',
      title: 'Copilote',
      aside: open(false),
      index: options.index,
    });
  }
  return card(
    {
      id: 'copilot',
      icon: 'message',
      title: 'Copilote',
      aside: unlinked ? pill('awaiting-approval', 'À relier') : null,
      index: options.index,
    },
    text(COPILOT_TEXT),
    open(true),
    unlinked
      ? linkForm(
          { draft: view.draft, notice: view.notice, busy: view.busy, revoked: view.link === 'revoked' },
          actions,
          'Relie l’extension une fois : tes gestes du copilote comptent alors à ton nom.',
        )
      : notice(view.notice),
  );
}

/* ---- The owner's Reveal session ---- */

function stateLine(account: Account): HTMLElement {
  switch (account.sessionState) {
    case 'none':
      return h('p', { class: 'pp-hint pp-hint--amber' }, 'Jamais synchronisée.');
    case 'expired':
      return h('p', { class: 'pp-hint pp-hint--amber' }, 'Session expirée.');
    case 'warning':
      return h('p', { class: 'pp-hint pp-hint--amber' }, 'Session bientôt expirée.');
    case 'valid':
      return h(
        'p',
        { class: 'pp-hint' },
        account.sessionUpdatedAt === null
          ? 'Session valide.'
          : `Session valide, envoyée ${whenOf(new Date(account.sessionUpdatedAt))}.`,
      );
  }
}

function who(account: Account, line: HTMLElement | null): HTMLElement {
  return h(
    'div',
    { class: 'pp-sync__who' },
    h('span', { class: 'pp-sync__name' }, account.creatorName),
    h('span', { class: 'pp-sync__handle' }, `@${account.handle}`),
    line,
  );
}

function accountRow(account: Account, neon: boolean, view: SyncView, actions: SyncActions): HTMLElement {
  const mine = view.pending?.accountId === account.id ? view.pending : null;
  return h(
    'div',
    { class: 'pp-sync__account' },
    who(account, stateLine(account)),
    button(
      'Synchroniser',
      () => {
        actions.sync(account.id);
      },
      neon ? 'neon' : 'soft',
      {
        busy: view.pending !== null,
        pending: mine === null ? null : mine.phase === 'reading' ? 'Lecture…' : 'Envoi…',
        small: true,
      },
    ),
  );
}

/** « Soleil (@soleil.noir) », with no break inside the handle. */
const named = (account: Account): string => `${account.creatorName} (@${account.handle})`;

/**
 * Before a session leaves: the account it goes to and the model the tab shows, so that a session is never sent to the
 * wrong account. A first sync names what to check and puts « Annuler » first; another model than last time can only be
 * cancelled. The server's own refusal stays the rule.
 */
function confirmRows(account: Account, confirm: Confirm, actions: SyncActions): readonly HTMLElement[] {
  const sentence =
    confirm.seen === 'other'
      ? h(
          'p',
          { class: 'pp-hint pp-hint--amber', role: 'status' },
          `Cet onglet montre un autre modèle qu’à la dernière synchro de ${named(account)} : ouvre la bonne créatrice dans Reveal, puis réessaie.`,
        )
      : text(
          confirm.seen === 'same'
            ? `Cet onglet montre le même modèle qu’à la dernière synchro de ${named(account)}.`
            : `Première synchro de ce compte : vérifie que cet onglet montre bien ${named(account)} avant d’envoyer.`,
        );
  return [
    who(account, null),
    sentence,
    h(
      'p',
      { class: 'pp-hint' },
      'Modèle lu dans l’onglet : ',
      h('code', { class: 'pp-code' }, confirm.modelId),
    ),
    h(
      'div',
      { class: 'pp-actions pp-actions--row' },
      button('Annuler', actions.cancel, 'plain', { focus: confirm.seen !== 'same' }),
      confirm.seen === 'other'
        ? null
        : button('Envoyer la session', actions.send, 'soft', { focus: confirm.seen === 'same' }),
    ),
  ];
}

function syncBody(view: SyncView, actions: SyncActions): readonly (HTMLElement | null)[] {
  const { state, accounts } = view.accounts;
  if (state === 'unreachable') {
    return [
      h('p', { class: 'pp-hint pp-hint--amber' }, 'Le CRM ne répond pas : réessaie dans un instant.'),
      button('Réessayer', actions.retry, 'plain'),
    ];
  }
  if (accounts.length === 0)
    return [text('Aucun compte Reveal dans le CRM : ajoute-le d’abord dans les réglages des connecteurs.')];
  const confirm = view.confirm;
  const confirmed =
    confirm === null ? undefined : accounts.find((account) => account.id === confirm.accountId);
  if (confirm !== null && confirmed !== undefined) return confirmRows(confirmed, confirm, actions);
  // One neon per screen (V-EXT-05): the first account whose session is missing or ending.
  const first = accounts.find((account) => account.sessionState !== 'valid');
  return [
    ...accounts.map((account) => accountRow(account, account === first, view, actions)),
    view.pending?.phase === 'reading'
      ? h(
          'p',
          { class: 'pp-hint', role: 'status' },
          'Lecture de la session : l’onglet Reveal peut se recharger une fois.',
        )
      : notice(view.notice),
    // Once every session is up to date, the advice steps back (V-EXT-01).
    first === undefined
      ? null
      : h(
          'p',
          { class: 'pp-hint' },
          'Garde la messagerie Reveal ouverte : la session est lue, envoyée au CRM, puis oubliée.',
        ),
  ];
}

/** The card's action is the screen's one neon: an account whose session is missing or ending. */
export function syncWanted(view: SyncView | null): boolean {
  if (view === null) return false;
  const { state, accounts } = view.accounts;
  return state === 'ok' && accounts.some((account) => account.sessionState !== 'valid');
}

/**
 * Its own card, beside the copilot's (V-EXT-09): only the owner sends a session. Not drawn without a link, whose
 * « Relier » is the copilot's, nor for a link that is not the owner's.
 */
export function syncCard(view: SyncView, actions: SyncActions, index: number): HTMLElement | null {
  const { state, accounts } = view.accounts;
  if (state === 'none' || state === 'revoked' || state === 'not-owner') return null;
  const status =
    state !== 'ok' || accounts.length === 0
      ? null
      : syncWanted(view)
        ? pill('awaiting-approval', 'À synchroniser')
        : pill('sent', 'À jour');
  return card(
    { id: 'sync', icon: 'rotate', title: 'Session Reveal', aside: status, index },
    syncBody(view, actions),
  );
}
