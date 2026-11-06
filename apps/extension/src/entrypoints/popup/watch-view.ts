import type { CreatorId } from '@impera/contracts';

import { h } from '../../lib/dom';
import { icon } from '../../lib/icons';
import type { MarkableCreators, WatchStatus } from '../../lib/watch/protocol';

/**
 * The « Veille Instagram » card of the popup (VEI-02, ADR 0060 § 2, source 6), on an Instagram tab, for the owner and
 * the managers. In order: the link to paste once (« Relier »), the browser's permission for instagram.com, then the
 * watch itself, with the marking of the post on screen. Pure: main.ts does the browser side.
 */

export interface WatchNotice {
  readonly tone: 'quiet' | 'amber';
  readonly text: string;
}

export interface WatchView {
  readonly status: WatchStatus;
  readonly creators: MarkableCreators['items'];
  readonly notice: WatchNotice | null;
  /** A gesture is on its way: the buttons wait. */
  readonly busy: boolean;
  readonly now: Date;
  /** What was typed in the link field, kept across a redraw. */
  readonly draft: string;
}

export interface WatchActions {
  readonly link: (code: string) => void;
  readonly allow: () => void;
  readonly begin: () => void;
  readonly end: () => void;
  readonly mark: (creatorId: CreatorId) => void;
  readonly openSecurity: () => void;
}

/** « 14 h 05 », the way the CRM writes an hour. */
export function hourOf(at: Date): string {
  return `${String(at.getHours())}\u00a0h\u00a0${String(at.getMinutes()).padStart(2, '0')}`;
}

/** « 1 min », « 12 min »: whole minutes since the start, at least one. */
export function minutesSince(start: Date, now: Date): string {
  return `${String(Math.max(1, Math.floor((now.getTime() - start.getTime()) / 60_000)))}\u00a0min`;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)}\u00a0${count > 1 ? many : one}`;
}

type Pill = 'sent' | 'idle' | 'awaiting-approval';

function pill(kind: Pill, label: string): HTMLElement {
  return h(
    'span',
    { class: `nv-status nv-status--${kind} pp-pill`, role: 'status' },
    h('span', { class: 'nv-status__dot', 'aria-hidden': 'true' }),
    label,
  );
}

function stateOf(status: WatchStatus): { pill: Pill; label: string } {
  if (status.link !== 'linked') return { pill: 'awaiting-approval', label: 'À relier' };
  if (!status.allowed) return { pill: 'awaiting-approval', label: 'À autoriser' };
  if (status.watch === null) return { pill: 'idle', label: 'Prête' };
  if (status.watch.amber) return { pill: 'awaiting-approval', label: 'À regarder' };
  return { pill: 'sent', label: 'Relève' };
}

function button(
  label: string,
  onClick: () => void,
  variant: 'neon' | 'soft' | 'plain',
  options: { readonly wide?: boolean; readonly busy?: boolean; readonly type?: 'button' | 'submit' } = {},
): HTMLButtonElement {
  const element = h(
    'button',
    {
      type: options.type ?? 'button',
      class: ['nv-btn', `nv-btn--${variant}`, 'nv-btn--sm', 'pp-btn', options.wide === true ? 'pp-wide' : '']
        .join(' ')
        .trim(),
      disabled: options.busy === true,
    },
    h('span', {}, label),
  );
  if (options.type !== 'submit') element.addEventListener('click', onClick);
  return element;
}

function text(content: string): HTMLElement {
  return h('p', { class: 'pp-watch__text' }, content);
}

function notice(content: WatchNotice | null): HTMLElement | null {
  if (content === null) return null;
  return h(
    'p',
    { class: content.tone === 'amber' ? 'pp-hint pp-hint--amber' : 'pp-hint', role: 'status' },
    content.text,
  );
}

function linkForm(view: WatchView, actions: WatchActions): readonly HTMLElement[] {
  const input = h('input', {
    class: 'nv-field__control pp-input',
    id: 'watch-link',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    value: view.draft,
    placeholder: 'Colle le code ici',
    'aria-describedby': 'watch-link-hint',
    'aria-invalid': view.notice?.tone === 'amber' ? 'true' : undefined,
  });
  const form = h(
    'form',
    { class: 'pp-watch__form' },
    h(
      'div',
      { class: 'nv-field' },
      h('label', { class: 'nv-field__label', for: 'watch-link' }, 'Code de liaison'),
      input,
      h(
        'p',
        { class: 'pp-hint', id: 'watch-link-hint' },
        'Dans le CRM : Sécurité, « Relier l’extension », puis Copier.',
      ),
    ),
    notice(view.notice),
    h(
      'div',
      { class: 'pp-actions pp-actions--row' },
      button('Ouvrir Sécurité', actions.openSecurity, 'plain'),
      button('Relier', () => undefined, 'neon', { busy: view.busy, type: 'submit' }),
    ),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.link(input.value);
  });
  return [
    ...(view.status.link === 'revoked'
      ? [
          h(
            'p',
            { class: 'pp-hint pp-hint--amber' },
            'Cette liaison a été retirée dans le CRM : colle un nouveau code.',
          ),
        ]
      : [text('Colle une fois le code de « Relier l’extension » : tes relevés arrivent alors à ton nom.')]),
    form,
  ];
}

function watching(view: WatchView, actions: WatchActions): readonly HTMLElement[] {
  const watch = view.status.watch;
  if (watch === null) return [];
  const start = new Date(watch.startedAt);
  const lastId = view.status.lastCreatorId;
  // The shortcut marks for the last creator chosen: shown once there is one.
  const lastName = view.creators.find((creator) => creator.id === lastId)?.displayName ?? null;
  const chips = view.creators.slice(0, 20).map((creator) => {
    const chip = h(
      'button',
      {
        type: 'button',
        class: 'nv-chip pp-watch__chip',
        'aria-pressed': creator.id === lastId ? 'true' : 'false',
        disabled: view.busy,
      },
      creator.displayName,
    );
    chip.addEventListener('click', () => {
      actions.mark(creator.id);
    });
    return chip;
  });
  const vision =
    view.status.vision === 'budget'
      ? 'Les captures ne sont plus décrites jusqu’à minuit : le plafond du jour est atteint. Le post reste marqué.'
      : view.status.vision === 'unavailable'
        ? 'Aucun modèle de vision ne répond : le post est marqué, sans description des captures.'
        : null;
  return [
    h(
      'p',
      { class: 'pp-watch__time' },
      `Depuis ${minutesSince(start, view.now)} · s’arrête à ${hourOf(new Date(watch.endsAt))}`,
    ),
    h(
      'p',
      { class: 'pp-watch__figures' },
      h('span', {}, plural(watch.posts, 'post relevé', 'posts relevés')),
      h('span', { 'aria-hidden': 'true' }, '·'),
      h('span', {}, plural(watch.marked, 'marqué', 'marqués')),
    ),
    ...(watch.amber
      ? [
          h(
            'p',
            { class: 'pp-hint pp-hint--amber' },
            'Instagram a changé sa page : plus rien n’est lu. Rien n’est rechargé, l’extension sera réparée.',
          ),
        ]
      : []),
    ...(vision === null ? [] : [h('p', { class: 'pp-hint pp-hint--amber' }, vision)]),
    h(
      'div',
      { class: 'pp-watch__mark' },
      h('p', { class: 'pp-watch__label', id: 'watch-mark' }, 'Marquer le post à l’écran pour'),
      chips.length === 0
        ? h('p', { class: 'pp-hint' }, 'Aucune créatrice à qui le marquer.')
        : h('div', { class: 'pp-watch__chips', role: 'group', 'aria-labelledby': 'watch-mark' }, ...chips),
      notice(view.notice),
    ),
    h(
      'div',
      { class: 'pp-actions pp-actions--row pp-watch__foot' },
      lastName === null
        ? h('span', {})
        : h(
            'span',
            { class: 'pp-watch__key' },
            h('kbd', {}, 'Alt'),
            '+',
            h('kbd', {}, 'Maj'),
            '+',
            h('kbd', {}, 'M'),
            h('span', { class: 'pp-watch__key-text' }, `marque pour ${lastName}`),
          ),
      button('Arrêter', actions.end, 'plain', { busy: view.busy }),
    ),
  ];
}

export function watchCard(view: WatchView, actions: WatchActions): HTMLElement {
  const state = stateOf(view.status);
  const body: readonly HTMLElement[] =
    view.status.link !== 'linked'
      ? linkForm(view, actions)
      : !view.status.allowed
        ? [
            text('Le navigateur doit laisser Impera lire instagram.com, et seulement ce site.'),
            text('Rien n’est lu tant que tu ne lances pas la veille.'),
            button('Autoriser et lancer', actions.allow, 'neon', { wide: true, busy: view.busy }),
          ]
        : view.status.watch === null
          ? [
              text(
                'Tu regardes, l’extension note les posts que tu vois. Jamais un message, jamais un clic à ta place. Elle s’arrête seule au bout de 45 minutes.',
              ),
              ...[notice(view.notice)].filter((line): line is HTMLElement => line !== null),
              button('Lancer la veille', actions.begin, 'neon', { wide: true, busy: view.busy }),
            ]
          : watching(view, actions);
  return h(
    'section',
    { class: 'pp-watch nv-plate nv-enter', style: '--nv-i: 3', 'data-place': 'instagram' },
    h(
      'header',
      { class: 'pp-watch__head' },
      h('span', { class: 'pp-place__icon' }, icon('eye', 18)),
      h('span', { class: 'pp-place__title' }, 'Veille Instagram'),
      pill(state.pill, state.label),
    ),
    h('div', { class: 'pp-watch__body' }, ...body),
  );
}
