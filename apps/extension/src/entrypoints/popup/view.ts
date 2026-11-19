import type { Me } from '@impera/contracts';

import { shortAddress } from '../../lib/crm-address';
import { h } from '../../lib/dom';
import { icon, type IconName } from '../../lib/icons';
import type { Place } from '../../lib/tab';
import {
  awayLabel,
  awayOf,
  awayTitle,
  firstNameOf,
  initialsOf,
  kindLabel,
  kindOf,
  shortcutsFor,
  type Shortcut,
} from '../../lib/who';

import { card, pill, text } from './card';
import {
  copilotCard,
  syncCard,
  syncWanted,
  type CopilotActions,
  type CopilotView,
  type SyncActions,
  type SyncView,
} from './reveal-view';
import { watchCard, type WatchActions, type WatchView } from './watch-view';

/** One screen of the popup (ADR 0066 § 6). Pure: the same state draws the same nodes; main.ts does the browser side. */
export type Screen =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'second_factor' }
  | { readonly kind: 'unreachable' }
  /** The CRM answers with a server error (EXT-08): the same title as the panel's (EXT-18). */
  | { readonly kind: 'server_down' }
  /** Something answers at the address, but not the CRM (EXT-08). */
  | { readonly kind: 'not_crm' }
  /** The CRM refuses this account the extension. */
  | { readonly kind: 'refused' }
  /** A deployed CRM whose address the browser has not allowed yet. */
  | { readonly kind: 'permission' }
  | {
      readonly kind: 'signed_in';
      readonly me: Me;
      readonly place: Place;
      /** The copilot's card on a Reveal tab, for every member who has the panel; null elsewhere and for a creator. */
      readonly copilot: CopilotView | null;
      /** The watch card on an Instagram tab, for the owner (ADR 0024, amended 16/11); null elsewhere. */
      readonly watch: WatchView | null;
      /** The Reveal session on a Reveal tab, for the owner alone (P2-01); null elsewhere. */
      readonly sync: SyncView | null;
    }
  /** `first`: no address was ever saved, the welcome (EXT-07). */
  | {
      readonly kind: 'address';
      readonly draft: string;
      readonly error: string | null;
      readonly first: boolean;
    };

export interface Actions {
  readonly signIn: () => void;
  readonly open: (path: string) => void;
  readonly retry: () => void;
  readonly grant: () => void;
  readonly editAddress: () => void;
  /** The copilot side panel (ADR 0086), from a Reveal tab. */
  readonly openPanel: () => void;
  readonly saveAddress: (value: string) => void;
  /** Back to the developer's address: offered in a development build only (EXT-07). */
  readonly resetAddress: () => void;
  readonly cancelAddress: () => void;
  readonly copilot: CopilotActions;
  readonly watch: WatchActions;
  readonly sync: SyncActions;
}

export interface Frame {
  readonly origin: string;
  readonly version: string;
  /** The hour of the greeting, 0 to 23. */
  readonly hour: number;
  /** A development build: the way back to localhost is offered. */
  readonly dev: boolean;
}

/** « Bonjour » from 5 h to 17 h 59, « Bonsoir » the rest of the day. */
export function greetingAt(hour: number): string {
  return hour >= 5 && hour < 18 ? 'Bonjour' : 'Bonsoir';
}

function button(
  label: string,
  onClick: () => void,
  options: {
    readonly variant?: 'neon' | 'soft' | 'plain';
    readonly icon?: IconName;
    readonly wide?: boolean;
  } = {},
): HTMLButtonElement {
  const variant = options.variant ?? 'soft';
  const element = h(
    'button',
    {
      type: 'button',
      class: ['nv-btn', `nv-btn--${variant}`, 'pp-btn', options.wide === true ? 'pp-wide' : '']
        .join(' ')
        .trim(),
    },
    h('span', {}, label),
    options.icon === undefined ? null : icon(options.icon, 16),
  );
  element.addEventListener('click', onClick);
  return element;
}

function pillOf(screen: Screen): HTMLElement | null {
  switch (screen.kind) {
    case 'signed_in': {
      const away = awayOf(screen.me);
      return away === null ? pill('sent', 'CRM relié') : pill('awaiting-approval', awayLabel(away));
    }
    case 'signed_out':
      return pill('idle', 'Déconnecté');
    case 'unreachable':
    case 'not_crm':
      return pill('error', 'Injoignable');
    case 'server_down':
      return pill('error', 'Indisponible');
    case 'refused':
      return pill('error', 'Refusé');
    case 'second_factor':
      return pill('awaiting-approval', 'Code à activer');
    case 'permission':
      return pill('awaiting-approval', 'À autoriser');
    case 'loading':
      // The pill's place, so the head does not jump when the screen arrives (V-EXT-25).
      return h('span', { class: 'pp-skeleton pp-skeleton--pill', 'aria-hidden': 'true' });
    case 'address':
      return null;
  }
}

/** A message screen: an icon in its tile, a title, one sentence, then the actions. */
function notice(
  tone: 'neutral' | 'amber',
  name: IconName,
  title: string,
  sentence: string,
  actions: readonly HTMLElement[],
): HTMLElement {
  return h(
    'section',
    { class: `pp-notice pp-notice--${tone} nv-enter`, style: '--nv-i: 1' },
    h('span', { class: 'pp-notice__icon' }, icon(name, 22)),
    h('h1', { class: 'pp-notice__title' }, title),
    h('p', { class: 'pp-notice__text' }, sentence),
    h('div', { class: 'pp-actions' }, ...actions),
  );
}

function signedOut(actions: Actions): HTMLElement {
  return h(
    'section',
    { class: 'pp-hero' },
    h('p', { class: 'pp-whisper nv-enter', style: '--nv-i: 1' }, 'Bienvenue.'),
    h(
      'p',
      { class: 'pp-hero__text nv-enter', style: '--nv-i: 2' },
      'Connecte-toi au CRM : l’extension reprend ta session, sans mot de passe à retaper ici.',
    ),
    h(
      'div',
      { class: 'pp-actions nv-enter', style: '--nv-i: 3' },
      button('Se connecter', actions.signIn, { variant: 'neon', icon: 'arrowRight', wide: true }),
    ),
    h(
      'p',
      { class: 'pp-fine nv-enter', style: '--nv-i: 4' },
      icon('shield', 14),
      'Mot de passe, code et Face ID restent dans le CRM, jamais dans l’extension.',
    ),
  );
}

function account(me: Me, onOpen: () => void): HTMLElement {
  const kind = kindOf(me);
  const unnamed = me.name.trim() === '';
  const name = unnamed ? me.email : me.name;
  const element = h(
    'button',
    {
      type: 'button',
      class: 'pp-account nv-glass nv-enter',
      style: '--nv-i: 2',
      // No native tooltip (V-EXT-21): the name says it to screen readers.
      'aria-label': `${name}, ton compte dans le CRM`,
    },
    // No neon ring: the neon is the screen's action (V-EXT-26).
    h('span', { class: 'nv-avatar pp-avatar', 'aria-hidden': 'true' }, initialsOf(me)),
    h(
      'span',
      { class: 'pp-account__text' },
      h('span', { class: 'pp-account__name' }, name),
      // An account with no name shows its e-mail once (V-EXT-27).
      h('span', { class: 'pp-account__sub' }, unnamed ? kindLabel(kind) : `${kindLabel(kind)} · ${me.email}`),
    ),
    h('span', { class: 'pp-account__go' }, icon('chevronRight', 16)),
  );
  element.addEventListener('click', onOpen);
  return element;
}

/** Where the person's own sessions and codes live in the CRM (apps/web/src/shell/nav.ts, `securityPathOf`). */
export function accountPathOf(me: Me): string {
  const kind = kindOf(me);
  if (kind === 'owner') return '/reglages/securite';
  if (kind === 'operator') return '/compte/securite';
  return '/moi/securite';
}

function tile(shortcut: Shortcut, index: number, onOpen: (path: string) => void): HTMLElement {
  const element = h(
    'button',
    { type: 'button', class: 'pp-tile nv-enter', style: `--nv-i: ${String(5 + index)}` },
    h('span', { class: 'pp-tile__icon' }, icon(shortcut.icon, 18)),
    h('span', { class: 'pp-tile__label' }, shortcut.label),
    h('span', { class: 'pp-tile__go' }, icon('arrowUpRight', 14)),
  );
  element.addEventListener('click', () => {
    onOpen(shortcut.path);
  });
  return element;
}

/**
 * The cards of the open tab, in order; empty when the tab asks nothing of this person. A member away from work sees
 * why the copilot does not open, wherever he is (EXT-10); a creator has no copilot (EXT-09, ADR 0086 § 7).
 */
function cardsOf(screen: Extract<Screen, { kind: 'signed_in' }>, actions: Actions): readonly HTMLElement[] {
  const away = awayOf(screen.me);
  if (away !== null) {
    return [
      card(
        { id: 'away', icon: 'planning', title: awayTitle(away), index: 3 },
        text('Aucun shift ne peut t’être posé : le copilote s’ouvre quand ton responsable te remet actif.'),
      ),
    ];
  }
  if (screen.place === 'instagram' && screen.watch !== null)
    return [watchCard(screen.watch, actions.watch, 3)];
  if (screen.place !== 'reveal' || screen.copilot === null) return [];
  const session = screen.sync === null ? null : syncCard(screen.sync, actions.sync, 4);
  return [
    copilotCard(
      screen.copilot,
      // One neon per screen: a session to send is the owner's action, the copilot steps back.
      { compact: session !== null, neon: !syncWanted(screen.sync), index: 3 },
      actions.openPanel,
      actions.copilot,
    ),
    ...(session === null ? [] : [session]),
  ];
}

function signedIn(
  screen: Extract<Screen, { kind: 'signed_in' }>,
  frame: Frame,
  actions: Actions,
): readonly HTMLElement[] {
  const { me } = screen;
  const first = firstNameOf(me);
  const shortcuts = shortcutsFor(kindOf(me));
  const cards = cardsOf(screen, actions);
  // With a card, the popup holds under the browser's 600 px (EXT-12, V-EXT-01): no greeting, the shortcuts on one row,
  // and « Ouvrir le CRM » left to them.
  const compact = cards.length > 0;
  return [
    compact
      ? null
      : h(
          'p',
          { class: 'pp-whisper nv-enter', style: '--nv-i: 1' },
          `${greetingAt(frame.hour)}${first === '' ? '' : ','}`,
          first === '' ? null : h('span', { class: 'pp-whisper__name' }, ` ${first}`),
          '.',
        ),
    account(me, () => {
      actions.open(accountPathOf(me));
    }),
    ...cards,
    h(
      'nav',
      {
        class: compact ? 'pp-tiles pp-tiles--compact' : 'pp-tiles',
        'aria-label': 'Raccourcis du CRM',
        'data-count': String(shortcuts.length),
      },
      ...shortcuts.map((shortcut, index) => tile(shortcut, index, actions.open)),
    ),
    compact
      ? null
      : h(
          'div',
          { class: 'pp-actions nv-enter', style: `--nv-i: ${String(5 + shortcuts.length)}` },
          button(
            'Ouvrir le CRM',
            () => {
              actions.open('/');
            },
            { variant: 'neon', icon: 'arrowUpRight', wide: true },
          ),
        ),
  ].filter((node): node is HTMLElement => node !== null);
}

function loading(): HTMLElement {
  return h(
    'section',
    { class: 'pp-loading', 'aria-busy': 'true', 'aria-label': 'Lecture de ta session' },
    h('span', { class: 'pp-skeleton pp-skeleton--line' }),
    h('span', { class: 'pp-skeleton pp-skeleton--card' }),
    h('span', { class: 'pp-skeleton pp-skeleton--tiles' }),
    h('span', { class: 'pp-skeleton pp-skeleton--button' }),
  );
}

/**
 * Where the CRM opens. The first time, a welcome rather than an error (EXT-07); the address a manager gives, never a
 * developer's. The way back to localhost stays in a development build only.
 */
function addressForm(
  screen: Extract<Screen, { kind: 'address' }>,
  frame: Frame,
  actions: Actions,
): HTMLElement {
  const input = h('input', {
    class: 'nv-field__control pp-input',
    id: 'crm-address',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    spellcheck: 'false',
    value: screen.draft,
    placeholder: 'crm.exemple.fr',
    'aria-invalid': screen.error === null ? undefined : 'true',
    'aria-describedby': 'crm-address-hint',
  });
  const back = frame.dev
    ? h('button', { type: 'button', class: 'pp-link', 'data-action': 'reset' }, 'Revenir à localhost:5173')
    : null;
  back?.addEventListener('click', actions.resetAddress);
  const form = h(
    'form',
    { class: 'pp-form nv-enter', style: '--nv-i: 1' },
    screen.first ? h('p', { class: 'pp-whisper' }, 'Bienvenue.') : null,
    h('h1', { class: 'pp-form__title' }, 'Où s’ouvre ton CRM ?'),
    h(
      'div',
      { class: 'nv-field' },
      h('label', { class: 'nv-field__label', for: 'crm-address' }, 'Adresse du CRM'),
      input,
      h(
        'p',
        { class: screen.error === null ? 'pp-hint' : 'pp-hint pp-hint--amber', id: 'crm-address-hint' },
        screen.error ?? 'L’adresse du CRM que ton responsable t’a donnée, en https.',
      ),
    ),
    // One column, as every notice of the popup (V-EXT-24): the action first, then the way back.
    h(
      'div',
      { class: 'pp-actions' },
      h('button', { type: 'submit', class: 'nv-btn nv-btn--neon pp-btn pp-wide' }, 'Enregistrer'),
      screen.first ? null : button('Annuler', actions.cancelAddress, { variant: 'plain', wide: true }),
      back,
    ),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.saveAddress(input.value);
  });
  // Échap steps back, as it closes a modal in the CRM: the popup itself stays open. The welcome has no way back.
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || screen.first) return;
    event.preventDefault();
    actions.cancelAddress();
  });
  return form;
}

function body(screen: Screen, frame: Frame, actions: Actions): readonly HTMLElement[] {
  const where = shortAddress(frame.origin);
  switch (screen.kind) {
    case 'loading':
      return [loading()];
    case 'signed_out':
      return [signedOut(actions)];
    case 'signed_in':
      return signedIn(screen, frame, actions);
    case 'unreachable':
      return [
        notice(
          'amber',
          'alert',
          'Le CRM ne répond pas',
          `Rien à l’adresse ${where}. Vérifie que le CRM est lancé, ou change l’adresse.`,
          [
            button('Réessayer', actions.retry, { variant: 'soft', icon: 'rotate' }),
            button('Changer l’adresse', actions.editAddress, { variant: 'plain' }),
          ],
        ),
      ];
    case 'server_down':
      return [
        notice(
          'amber',
          'alert',
          // The panel's title for the same trouble (EXT-18).
          'Le CRM ne répond pas',
          'Le CRM est là, mais son serveur est en erreur : réessaie dans un instant.',
          [button('Réessayer', actions.retry, { variant: 'soft', icon: 'rotate', wide: true })],
        ),
      ];
    case 'not_crm':
      return [
        notice(
          'amber',
          'alert',
          'Ce n’est pas un CRM Impera',
          `Quelque chose répond à ${where}, mais pas le CRM. Vérifie l’adresse.`,
          [
            button('Changer l’adresse', actions.editAddress, { variant: 'soft', wide: true }),
            button('Réessayer', actions.retry, { variant: 'plain' }),
          ],
        ),
      ];
    case 'refused':
      return [
        notice(
          'amber',
          'shield',
          'Ce compte ne peut pas ouvrir l’extension',
          'Le CRM la refuse à ce compte. Demande à ton responsable si c’est une erreur.',
          [button('Ouvrir le CRM', actions.signIn, { variant: 'soft', icon: 'arrowUpRight', wide: true })],
        ),
      ];
    case 'second_factor':
      return [
        notice(
          'amber',
          'shield',
          'Active ton code d’abord',
          'Ton compte doit activer son code de connexion dans le CRM. Ensuite, l’extension s’ouvre connectée.',
          [button('Ouvrir le CRM', actions.signIn, { variant: 'neon', icon: 'arrowUpRight', wide: true })],
        ),
      ];
    case 'permission':
      return [
        notice(
          'neutral',
          'key',
          'Autorise l’adresse du CRM',
          `Le navigateur doit laisser Impera lire ${where}, et seulement ce site.`,
          [
            button('Autoriser', actions.grant, { variant: 'neon', wide: true }),
            button('Changer l’adresse', actions.editAddress, { variant: 'plain' }),
          ],
        ),
      ];
    case 'address':
      return [addressForm(screen, frame, actions)];
  }
}

export function render(root: HTMLElement, screen: Screen, frame: Frame, actions: Actions): void {
  const status = pillOf(screen);
  const address = h(
    'button',
    // No native tooltip (V-EXT-21): the pencil shows on hover, the label tells screen readers.
    {
      type: 'button',
      class: 'pp-address',
      'aria-label': `Changer l’adresse du CRM (${shortAddress(frame.origin)})`,
    },
    h('span', {}, shortAddress(frame.origin)),
    icon('pencil', 12),
  );
  address.addEventListener('click', actions.editAddress);
  const main = h(
    'main',
    { class: 'nv-aura nv-popup pp', 'data-screen': screen.kind },
    h(
      'header',
      { class: 'nv-popup__head nv-enter', style: '--nv-i: 0' },
      h(
        'span',
        { class: 'pp-lockup' },
        h('img', { class: 'pp-mark', src: '/icon/mark.svg', width: 28, height: 28, alt: '' }),
        h('span', { class: 'nv-popup__brand' }, 'Impera'),
      ),
      status,
    ),
    h('div', { class: 'pp-body' }, ...body(screen, frame, actions)),
    h(
      'footer',
      { class: 'pp-foot' },
      screen.kind === 'address' ? h('span', {}) : address,
      h('span', { class: 'pp-version' }, `v${frame.version}`),
    ),
  );
  // Leaving the address (Échap, Annuler, Enregistrer) hands the focus back to the address button that opened it, never
  // to the page's body (relecture de #621).
  const leavesAddress =
    screen.kind !== 'address' && root.querySelector('.pp-form')?.contains(document.activeElement) === true;
  root.replaceChildren(main);
  if (screen.kind === 'address') root.querySelector<HTMLInputElement>('#crm-address')?.focus();
  else if (leavesAddress) address.focus();
  else root.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}
