import type { PlatformAccountId } from '@impera/contracts';

import { h } from '../../lib/dom';
import { hourOf } from '../../lib/hour';
import { icon } from '../../lib/icons';
import { revealMark } from '../../lib/reveal-mark';
import type { RevealAccounts, RevealSeen, RevealSynced } from '../../lib/watch/protocol';

import { button, card, pill, text } from './card';
import { withTip } from './tip';
import { linkForm, notice, type WatchActions, type WatchNotice } from './watch-view';

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

/** Why a « Sync » did not store a session: each one has its cause and the gesture that mends it. */
/**
 * `extension`: the extension's own worker did not answer the popup (a worker left over after a reload, retour PC du
 * 19/11): never said to be the CRM's fault.
 */
export type SyncFailure =
  Exclude<RevealSynced['state'], 'synced'> | 'no-session' | 'several' | 'extension' | 'other-account';

/** What the last gesture left under its account: the session stored, or why not. */
export type SyncOutcome =
  | {
      readonly kind: 'synced';
      readonly accountId: PlatformAccountId;
      readonly expiresAt: string | null;
      readonly reconnectFirst: boolean;
      readonly kept: boolean;
      /** Sent by the extension alone when the popup opened (ADR 0147 § 6): the owner sees it left without him. */
      readonly auto: boolean;
    }
  | {
      readonly kind: 'failed';
      readonly accountId: PlatformAccountId;
      readonly failure: SyncFailure;
      /** `other-account`: the account whose creator the tab shows (EXT-05). */
      readonly other?: PlatformAccountId;
    };

export interface SyncView {
  readonly accounts: RevealAccounts;
  readonly outcome: SyncOutcome | null;
  /** The account whose session is on its way, and how far (EXT-19, V-EXT-16); null while nothing is. */
  readonly pending: { readonly accountId: PlatformAccountId; readonly phase: 'reading' | 'sending' } | null;
  readonly confirm: Confirm | null;
  readonly now: Date;
  /** The CRM's address as this extension is set, named when it does not answer (avis Design du 19/11). */
  readonly crm: string;
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

/**
 * One line per account, read in this order (demande de Charles du 19/11, avis Design): who, the state in a word with its
 * dot, the hour it holds until, then the one gesture to make, or the cause of the last failure and its gesture. Red is
 * for a session cut alone; nothing is said twice and no advice stays once all is well.
 */

type Tone = 'ok' | 'amber' | 'red' | 'neutral';

const STATES: Readonly<Record<Account['sessionState'], { readonly tone: Tone; readonly word: string }>> = {
  valid: { tone: 'ok', word: 'Connectée' },
  warning: { tone: 'amber', word: 'Expire bientôt' },
  expired: { tone: 'red', word: 'Coupée' },
  none: { tone: 'neutral', word: 'Jamais branchée' },
};

/** A Reveal token lasts a day from the login (reveal-api-observed.md): the gauge's full length. */
const TOKEN_LIFE_MS = 24 * 3_600_000;

const RECONNECT = 'Reconnecte-toi à Reveal, puis resynchronise.';
/** A token stored with less than a day ahead: why a new login, then the gesture (avis Design du 19/11). */
const SHORT_TOKEN = 'Pour 24 h pleines : reconnecte-toi à Reveal, puis resynchronise.';

/** The cause, then the gesture (demande de Charles du 19/11: « la vraie cause et le geste à faire »). */
export function failureOf(
  failure: SyncFailure,
  crm: string,
  shows?: string,
): { readonly cause: string; readonly gesture: string } {
  switch (failure) {
    case 'other-account':
      return {
        cause: `Cet onglet montre ${shows ?? 'une autre créatrice du CRM'}.`,
        gesture: 'Synchronise sa ligne à elle, ou ouvre la bonne créatrice dans Reveal, puis resynchronise.',
      };
    case 'no-session':
      return {
        cause: 'Aucune session lue dans cet onglet.',
        gesture: 'Ouvre la messagerie Reveal ici, puis resynchronise.',
      };
    case 'expired':
      return {
        cause: 'La session lue a été oubliée au bout d’une minute.',
        gesture: 'Resynchronise, puis envoie-la sans attendre.',
      };
    case 'unlinked':
      return {
        cause: 'L’extension n’est pas reliée.',
        gesture: 'Relie-la avec le code de la page Sécurité.',
      };
    case 'revoked':
      return {
        cause: 'Cette liaison a été retirée dans le CRM.',
        gesture: 'Colle un nouveau code dans le copilote.',
      };
    case 'not-owner':
      return {
        cause: 'Seul le propriétaire envoie une session.',
        gesture: 'Relie l’extension avec le code du propriétaire.',
      };
    case 'several':
      return {
        cause: 'Cet onglet montre plusieurs créatrices, et aucune n’est celle de ce compte.',
        gesture: 'Ouvre dans Reveal la messagerie de la créatrice de ce compte, puis resynchronise.',
      };
    case 'other-model':
      return {
        cause: 'Cet onglet montre une autre créatrice que ce compte.',
        gesture: 'Ouvre la bonne dans Reveal, puis resynchronise.',
      };
    case 'other-member':
      return {
        cause: 'Cet onglet est connecté avec un autre membre que le « bot » de ce compte.',
        gesture: 'Connecte-toi à Reveal avec le « bot », puis resynchronise.',
      };
    case 'refused':
      return {
        cause: 'Le CRM a refusé cette session.',
        gesture: 'Recharge l’onglet Reveal, puis resynchronise.',
      };
    case 'busy':
      // A 429: the CRM is up, it counts the tries of the last minute (Bilan, 20/11).
      return { cause: 'Trop d’essais d’un coup.', gesture: 'Attends une minute, puis resynchronise.' };
    case 'unreachable':
      return { cause: `Le CRM ne répond pas à ${crm}.`, gesture: 'Vérifie qu’il tourne, puis réessaie.' };
    case 'extension':
      return {
        cause: 'L’extension ne répond plus.',
        gesture:
          'Recharge-la (chrome://extensions, flèche ronde d’Impera), puis l’onglet Reveal, et resynchronise.',
      };
  }
}

const DAY_MS = 86_400_000;

/** « 19/11 à 14 h 37 »: a tip's day, without the year (avis Design du 19/11). */
function shortWhenOf(at: Date): string {
  return `${at.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${hourOf(at)}`;
}

/** « jusqu’à 9 h 05 » today, « jusqu’à demain 9 h 05 », else « jusqu’au 28/11/2026 à 9 h 05 » (EXT-03). */
export function untilOf(at: Date, now: Date): string {
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      DAY_MS,
  );
  if (days === 0) return `jusqu’à ${hourOf(at)}`;
  if (days === 1) return `jusqu’à demain ${hourOf(at)}`;
  const day = at.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `jusqu’au ${day} à ${hourOf(at)}`;
}

function dot(tone: Tone, live: boolean): HTMLElement {
  return h('span', {
    class: `pp-sync__dot pp-sync__dot--${tone}${live ? ' is-live' : ''}`,
    'aria-hidden': 'true',
  });
}

/** The time left of the token as one thin line, only while it holds and its end is known (avis Design du 19/11). */
function gauge(tone: Tone, expiresAt: Date | null, now: Date, fresh: boolean): HTMLElement | null {
  if (expiresAt === null || tone === 'red' || tone === 'neutral') return null;
  const left = Math.max(0, Math.min(1, (expiresAt.getTime() - now.getTime()) / TOKEN_LIFE_MS));
  return h(
    'div',
    {
      class: `nv-gauge pp-sync__gauge pp-sync__gauge--${tone}${fresh ? ' is-fresh' : ''}`,
      role: 'presentation',
      style: `--nv-gauge-value: ${String(Math.round(left * 100))}%`,
    },
    h('span', { class: 'nv-gauge__fill' }),
  );
}

interface RowState {
  readonly tone: Tone;
  readonly word: string;
  readonly until: Date | null;
  readonly synced: Extract<SyncOutcome, { kind: 'synced' }> | null;
  readonly failure: SyncFailure | null;
  /** The creator the tab shows instead, by her name in the CRM (EXT-05). */
  readonly shows: string | undefined;
  readonly phase: 'reading' | 'sending' | null;
}

function rowStateOf(account: Account, view: SyncView): RowState {
  const outcome = view.outcome?.accountId === account.id ? view.outcome : null;
  const synced = outcome?.kind === 'synced' ? outcome : null;
  const at = synced?.expiresAt ?? account.sessionExpiresAt;
  const until = at === null ? null : new Date(at);
  const { tone, word } = STATES[account.sessionState];
  return {
    tone,
    word: synced?.auto === true ? 'Synchronisée à l’ouverture' : word,
    until: until !== null && until > view.now ? until : null,
    synced,
    failure: outcome?.kind === 'failed' ? outcome.failure : null,
    shows:
      outcome?.kind === 'failed'
        ? view.accounts.accounts.find((other) => other.id === outcome.other)?.creatorName
        : undefined,
    phase: view.pending?.accountId === account.id ? view.pending.phase : null,
  };
}

/** The state in a word, its dot, and the hour it holds until; its tip gives the days behind it, never more. */
function statusLine(account: Account, row: RowState, now: Date): HTMLElement {
  if (row.phase !== null) {
    return h(
      'p',
      { class: 'pp-sync__state', role: 'status' },
      dot('neutral', true),
      h('span', { class: 'pp-sync__word' }, row.phase === 'reading' ? 'Lecture de l’onglet' : 'Envoi au CRM'),
      h('span', { class: 'pp-sync__step' }, row.phase === 'reading' ? '1/2' : '2/2'),
    );
  }
  const line = h(
    'p',
    { class: 'pp-sync__state', role: row.synced === null ? undefined : 'status' },
    row.synced === null
      ? dot(row.tone, false)
      : h('span', { class: 'pp-sync__check', 'aria-hidden': 'true' }, icon('check', 12)),
    h('span', { class: `pp-sync__word pp-sync__word--${row.tone}` }, row.word),
    row.until === null || row.tone === 'red'
      ? null
      : h('span', { class: 'pp-sync__until' }, untilOf(row.until, now)),
  );
  if (account.sessionUpdatedAt === null) return line;
  return withTip(line, {
    title: `${account.creatorName} sur Reveal`,
    rows: [
      { label: 'Synchronisée', value: shortWhenOf(new Date(account.sessionUpdatedAt)) },
      ...(row.until === null ? [] : [{ label: 'Fin du jeton', value: shortWhenOf(row.until) }]),
    ],
  });
}

/** Under one account: the last failure's cause and gesture, or what a session just stored still asks; else nothing. */
function adviceLine(row: RowState, crm: string): HTMLElement | null {
  if (row.phase !== null) return null;
  if (row.failure !== null) {
    const { cause, gesture } = failureOf(row.failure, crm, row.shows);
    return h(
      'p',
      { class: 'pp-sync__fail', role: 'status' },
      h('span', { class: 'pp-sync__cause' }, cause),
      ' ',
      gesture,
    );
  }
  if (row.synced?.kept === true)
    return h(
      'p',
      { class: 'pp-sync__advice' },
      'La session en place tient plus longtemps : elle est gardée.',
    );
  if (row.synced?.reconnectFirst === true) return h('p', { class: 'pp-sync__advice' }, SHORT_TOKEN);
  return null;
}

/** « Resynchroniser », a word at the end of a line at rest: always there, never calling (avis Design du 19/11). */
function again(onClick: () => void, busy: boolean): HTMLButtonElement {
  const element = h(
    'button',
    { type: 'button', class: 'pp-link pp-sync__again', disabled: busy },
    h('span', {}, 'Resynchroniser'),
  );
  element.addEventListener('click', onClick);
  return element;
}

function accountRow(account: Account, neon: boolean, view: SyncView, actions: SyncActions): HTMLElement {
  const row = rowStateOf(account, view);
  const sync = (): void => {
    actions.sync(account.id);
  };
  const busy = view.pending !== null;
  const pending = row.phase === null ? null : row.phase === 'reading' ? 'Lecture…' : 'Envoi…';
  // At rest the action steps back to a word at the end of the line; it stays, never hidden (avis Design du 19/11).
  const action =
    row.tone === 'ok' && pending === null
      ? again(sync, busy)
      : button('Synchroniser', sync, neon ? 'neon' : 'soft', { busy, pending, small: true });
  return h(
    'div',
    { class: 'pp-sync__account', 'data-tone': row.tone },
    h(
      'div',
      { class: 'pp-sync__top' },
      h(
        'div',
        { class: 'pp-sync__who' },
        h('span', { class: 'pp-sync__name' }, account.creatorName),
        h('span', { class: 'pp-sync__handle' }, `@${account.handle}`),
      ),
      action,
    ),
    statusLine(account, row, view.now),
    row.phase === null ? gauge(row.tone, row.until, view.now, row.synced !== null) : null,
    adviceLine(row, view.crm),
  );
}

/** « Soleil (@soleil.noir) », with no break inside the handle. */
const named = (account: Account): string => `${account.creatorName} (@${account.handle})`;

/**
 * Before a session leaves (demande de Sécurité): the account it goes to and the model the tab shows. A first sync names
 * what to check and puts « Annuler » first; another model than last time can only be cancelled. The server's own
 * refusal stays the rule.
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
    h(
      'div',
      { class: 'pp-sync__who' },
      h('span', { class: 'pp-sync__name' }, account.creatorName),
      h('span', { class: 'pp-sync__handle' }, `@${account.handle}`),
    ),
    sentence,
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
  if (state === 'unreachable' || state === 'busy') {
    const { cause, gesture } = failureOf(state, view.crm);
    return [
      h(
        'p',
        { class: 'pp-sync__fail', role: 'status' },
        h('span', { class: 'pp-sync__cause' }, cause),
        ' ',
        gesture,
      ),
      h('div', { class: 'pp-sync__retry' }, button('Réessayer', actions.retry, 'soft', { small: true })),
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
  // The gesture a late session asks for, said once under the list, whatever the number of accounts (avis Design).
  const late = accounts.some(
    (account) =>
      (account.sessionState === 'expired' || account.sessionState === 'warning') &&
      view.pending?.accountId !== account.id &&
      !(view.outcome?.kind === 'failed' && view.outcome.accountId === account.id),
  );
  return [
    ...accounts.map((account) => accountRow(account, account === first, view, actions)),
    late ? h('p', { class: 'pp-sync__advice pp-sync__advice--all' }, RECONNECT) : null,
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
 * « Relier » is the copilot's, nor for a link that is not the owner's. Its state lives on each account's line: the head
 * says nothing twice.
 */
export function syncCard(view: SyncView, actions: SyncActions, index: number): HTMLElement | null {
  const { state } = view.accounts;
  if (state === 'none' || state === 'revoked' || state === 'not-owner') return null;
  const mark = revealMark(view.pending !== null);
  return card({ id: 'sync', icon: mark, title: 'Session Reveal', index }, syncBody(view, actions));
}
