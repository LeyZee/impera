import type { Me } from '@impera/contracts';

import { shortAddress } from '../../lib/crm-address';
import { h } from '../../lib/dom';
import { icon, type IconName } from '../../lib/icons';
import type { Place } from '../../lib/tab';
import { firstNameOf, initialsOf, kindLabel, kindOf, shortcutsFor, type Shortcut } from '../../lib/who';

import { watchCard, type WatchActions, type WatchView } from './watch-view';

/** One screen of the popup (ADR 0066 § 6). Pure: the same state draws the same nodes; main.ts does the browser side. */
export type Screen =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'second_factor' }
  | { readonly kind: 'unreachable' }
  /** The CRM answers, the API behind it does not: the same words as the CRM's own screen. */
  | { readonly kind: 'server_down' }
  /** A deployed CRM whose address the browser has not allowed yet. */
  | { readonly kind: 'permission' }
  | {
      readonly kind: 'signed_in';
      readonly me: Me;
      readonly place: Place;
      /** The watch card on an Instagram tab, for the owner and the managers; null elsewhere. */
      readonly watch: WatchView | null;
    }
  | { readonly kind: 'address'; readonly draft: string; readonly error: string | null };

export interface Actions {
  readonly signIn: () => void;
  readonly open: (path: string) => void;
  readonly retry: () => void;
  readonly grant: () => void;
  readonly editAddress: () => void;
  readonly saveAddress: (value: string) => void;
  readonly resetAddress: () => void;
  readonly cancelAddress: () => void;
  readonly watch: WatchActions;
}

export interface Frame {
  readonly origin: string;
  readonly version: string;
  /** The hour of the greeting, 0 to 23. */
  readonly hour: number;
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

function pill(kind: 'sent' | 'idle' | 'error' | 'awaiting-approval', label: string): HTMLElement {
  return h(
    'span',
    { class: `nv-status nv-status--${kind} pp-pill`, role: 'status' },
    h('span', { class: 'nv-status__dot', 'aria-hidden': 'true' }),
    label,
  );
}

function pillOf(screen: Screen): HTMLElement | null {
  switch (screen.kind) {
    case 'signed_in':
      return pill('sent', 'Connecté');
    case 'signed_out':
      return pill('idle', 'Déconnecté');
    case 'unreachable':
      return pill('error', 'Injoignable');
    case 'server_down':
      return pill('error', 'Indisponible');
    case 'second_factor':
      return pill('awaiting-approval', 'Code à activer');
    case 'permission':
      return pill('awaiting-approval', 'À autoriser');
    case 'loading':
    case 'address':
      return null;
  }
}

/** A message screen: an icon in its tile, a title, one sentence, then the actions. */
function notice(
  tone: 'neutral' | 'amber',
  name: IconName,
  title: string,
  text: string,
  actions: readonly HTMLElement[],
): HTMLElement {
  return h(
    'section',
    { class: `pp-notice pp-notice--${tone} nv-enter`, style: '--nv-i: 1' },
    h('span', { class: 'pp-notice__icon' }, icon(name, 22)),
    h('h1', { class: 'pp-notice__title' }, title),
    h('p', { class: 'pp-notice__text' }, text),
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
  const card = h(
    'button',
    {
      type: 'button',
      class: 'pp-account nv-glass nv-enter',
      style: '--nv-i: 2',
      title: 'Ton compte dans le CRM',
    },
    h('span', { class: 'nv-avatar nv-avatar--ring pp-avatar', 'aria-hidden': 'true' }, initialsOf(me)),
    h(
      'span',
      { class: 'pp-account__text' },
      h('span', { class: 'pp-account__name' }, me.name.trim() === '' ? me.email : me.name),
      h('span', { class: 'pp-account__sub' }, `${kindLabel(kind)} · ${me.email}`),
    ),
    h('span', { class: 'pp-account__go' }, icon('chevronRight', 16)),
  );
  card.addEventListener('click', onOpen);
  return card;
}

/** Where the person's own sessions and codes live in the CRM (apps/web/src/shell/nav.ts, `securityPathOf`). */
export function accountPathOf(me: Me): string {
  const kind = kindOf(me);
  if (kind === 'owner') return '/reglages/securite';
  if (kind === 'operator') return '/compte/securite';
  return '/moi/securite';
}

const PLACES: Partial<Record<Place, { icon: IconName; title: string; text: string }>> = {
  reveal: {
    icon: 'message',
    title: 'Reveal',
    text: 'La capture de session arrive à la prochaine étape. Pour l’instant, rien n’est lu ni envoyé depuis cet onglet.',
  },
};

function placeCard(place: Place): HTMLElement | null {
  const card = PLACES[place];
  if (card === undefined) return null;
  return h(
    'section',
    { class: 'pp-place nv-plate nv-enter', style: '--nv-i: 3', 'data-place': place },
    h('span', { class: 'pp-place__icon' }, icon(card.icon, 18)),
    h(
      'span',
      { class: 'pp-place__body' },
      h(
        'span',
        { class: 'pp-place__head' },
        h('span', { class: 'pp-place__title' }, card.title),
        pill('idle', 'Bientôt'),
      ),
      h('span', { class: 'pp-place__text' }, card.text),
    ),
  );
}

function tile(shortcut: Shortcut, index: number, onOpen: (path: string) => void): HTMLElement {
  const element = h(
    'button',
    { type: 'button', class: 'pp-tile nv-enter', style: `--nv-i: ${String(4 + index)}` },
    h('span', { class: 'pp-tile__icon' }, icon(shortcut.icon, 18)),
    h('span', { class: 'pp-tile__label' }, shortcut.label),
    h('span', { class: 'pp-tile__go' }, icon('arrowUpRight', 14)),
  );
  element.addEventListener('click', () => {
    onOpen(shortcut.path);
  });
  return element;
}

function signedIn(
  me: Me,
  place: Place,
  watch: WatchView | null,
  frame: Frame,
  actions: Actions,
): readonly HTMLElement[] {
  const first = firstNameOf(me);
  const shortcuts = shortcutsFor(kindOf(me));
  const showsWatch = place === 'instagram' && watch !== null;
  return [
    h(
      'p',
      { class: 'pp-whisper nv-enter', style: '--nv-i: 1' },
      `${greetingAt(frame.hour)}${first === '' ? '' : ','}`,
      first === '' ? null : h('span', { class: 'pp-whisper__name' }, ` ${first}`),
      '.',
    ),
    account(me, () => {
      actions.open(accountPathOf(me));
    }),
    ...[showsWatch ? watchCard(watch, actions.watch) : placeCard(place)].filter(
      (card): card is HTMLElement => card !== null,
    ),
    h(
      'nav',
      { class: 'pp-tiles', 'aria-label': 'Raccourcis du CRM', 'data-count': String(shortcuts.length) },
      ...shortcuts.map((shortcut, index) => tile(shortcut, index, actions.open)),
    ),
    h(
      'div',
      { class: 'pp-actions nv-enter', style: `--nv-i: ${String(5 + shortcuts.length)}` },
      button(
        'Ouvrir le CRM',
        () => {
          actions.open('/');
        },
        // One neon per screen: on a watch, its action is the one; « Ouvrir le CRM » steps back.
        { variant: showsWatch ? 'soft' : 'neon', icon: 'arrowUpRight', wide: true },
      ),
    ),
  ];
}

function loading(): HTMLElement {
  return h(
    'section',
    { class: 'pp-loading', 'aria-busy': 'true', 'aria-label': 'Lecture de ta session' },
    h('span', { class: 'pp-skeleton pp-skeleton--line' }),
    h('span', { class: 'pp-skeleton pp-skeleton--card' }),
    h('span', { class: 'pp-skeleton pp-skeleton--tiles' }),
  );
}

function addressForm(screen: { draft: string; error: string | null }, actions: Actions): HTMLElement {
  const input = h('input', {
    class: 'nv-field__control pp-input',
    id: 'crm-address',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    spellcheck: 'false',
    value: screen.draft,
    placeholder: 'localhost:5173',
    'aria-invalid': screen.error === null ? undefined : 'true',
    'aria-describedby': 'crm-address-hint',
  });
  const form = h(
    'form',
    { class: 'pp-form nv-enter', style: '--nv-i: 1' },
    h('h1', { class: 'pp-form__title' }, 'Adresse du CRM'),
    h(
      'div',
      { class: 'nv-field' },
      h('label', { class: 'nv-field__label', for: 'crm-address' }, 'Où le CRM s’ouvre dans ce navigateur'),
      input,
      h(
        'p',
        { class: screen.error === null ? 'pp-hint' : 'pp-hint pp-hint--amber', id: 'crm-address-hint' },
        screen.error ?? 'Sur ce PC : localhost:5173. Une fois déployé : son adresse en https.',
      ),
    ),
    h(
      'div',
      { class: 'pp-actions pp-actions--row' },
      button('Annuler', actions.cancelAddress, { variant: 'plain' }),
      h('button', { type: 'submit', class: 'nv-btn nv-btn--neon pp-btn' }, 'Enregistrer'),
    ),
    h('button', { type: 'button', class: 'pp-link', 'data-action': 'reset' }, 'Revenir à localhost:5173'),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.saveAddress(input.value);
  });
  form.querySelector('[data-action="reset"]')?.addEventListener('click', actions.resetAddress);
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
      return signedIn(screen.me, screen.place, screen.watch, frame, actions);
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
          'Le serveur ne répond pas',
          'Le CRM est là, mais Impera ne répond pas : réessaie dans un instant.',
          [button('Réessayer', actions.retry, { variant: 'soft', icon: 'rotate', wide: true })],
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
      return [addressForm(screen, actions)];
  }
}

export function render(root: HTMLElement, screen: Screen, frame: Frame, actions: Actions): void {
  const status = pillOf(screen);
  const address = h(
    'button',
    { type: 'button', class: 'pp-address', title: 'Changer l’adresse du CRM' },
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
  root.replaceChildren(main);
  if (screen.kind === 'address') root.querySelector<HTMLInputElement>('#crm-address')?.focus();
}
