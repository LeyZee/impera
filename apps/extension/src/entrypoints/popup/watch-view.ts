import type { CreatorId } from '@impera/contracts';

import { h } from '../../lib/dom';
import type { MarkableCreators, WatchStatus } from '../../lib/watch/protocol';

import { button, card, goLink, part, pill, text, type PillKind } from './card';

/**
 * The « Veille Instagram » card of the popup (VEI-02, ADR 0060 § 2, source 6), on an Instagram tab, for the owner
 * alone (ADR 0024, amendement du 16/11). In order: the link to paste once (« Relier »), the browser's permission for instagram.com, then the
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

function stateOf(status: WatchStatus): { pill: PillKind; label: string } {
  if (status.link !== 'linked') return { pill: 'awaiting-approval', label: 'À relier' };
  if (!status.allowed) return { pill: 'awaiting-approval', label: 'À autoriser' };
  if (status.watch === null) return { pill: 'idle', label: 'Prête' };
  if (status.watch.amber) return { pill: 'awaiting-approval', label: 'À regarder' };
  // V-EXT-30: who acts is clear, the watch runs.
  return { pill: 'sent', label: 'En cours' };
}

export function notice(content: WatchNotice | null): HTMLElement | null {
  if (content === null) return null;
  return h(
    'p',
    { class: content.tone === 'amber' ? 'pp-hint pp-hint--amber' : 'pp-hint', role: 'status' },
    content.text,
  );
}

/** The « Relier » part, shared by the copilot and the watch: one link per extension (ADR 0066 § 7). */
export interface LinkFormView {
  readonly draft: string;
  readonly notice: WatchNotice | null;
  readonly busy: boolean;
  readonly revoked: boolean;
}

/**
 * The code on one line with its button, where it comes from under it, then the way to Sécurité as a link in ink with
 * its chevron (popup-recette-1 and -2). The label stays for screen readers: the placeholder says it to the eye.
 */
export function linkForm(
  view: LinkFormView,
  actions: Pick<WatchActions, 'link' | 'openSecurity'>,
  intro: string,
): HTMLElement {
  const input = h('input', {
    class: 'nv-field__control pp-input',
    id: 'extension-link',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    value: view.draft,
    placeholder: 'Colle le code ici',
    'aria-describedby': 'extension-link-hint',
    'aria-invalid': view.notice?.tone === 'amber' ? 'true' : undefined,
  });
  const form = h(
    'form',
    { class: 'pp-link-form' },
    h('label', { class: 'pp-sr', for: 'extension-link' }, 'Code de liaison'),
    h(
      'div',
      { class: 'pp-inline' },
      input,
      button('Relier', () => undefined, 'soft', {
        busy: view.busy,
        pending: view.busy ? 'Envoi…' : null,
        type: 'submit',
      }),
    ),
    h(
      'p',
      { class: 'pp-hint', id: 'extension-link-hint' },
      'Le code est dans le CRM : Sécurité, «\u00a0Relier l’extension\u00a0».',
    ),
    notice(view.notice),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.link(input.value);
  });
  return part(
    view.revoked
      ? h(
          'p',
          { class: 'pp-hint pp-hint--amber' },
          'Cette liaison a été retirée dans le CRM : colle un nouveau code.',
        )
      : text(intro),
    form,
    goLink('Ouvrir Sécurité', actions.openSecurity),
  );
}

function watching(view: WatchView, actions: WatchActions): readonly (HTMLElement | null)[] {
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
    // V-EXT-30: one amber line when Instagram changed its page; the cap of the vision after a marking only.
    watch.amber
      ? h('p', { class: 'pp-hint pp-hint--amber' }, 'Instagram a changé sa page : plus rien n’est lu.')
      : null,
    h(
      'div',
      { class: 'pp-watch__mark' },
      h('p', { class: 'pp-watch__label', id: 'watch-mark' }, 'Marquer le post à l’écran pour'),
      chips.length === 0
        ? h('p', { class: 'pp-hint' }, 'Aucune créatrice à qui le marquer.')
        : h('div', { class: 'pp-watch__chips', role: 'group', 'aria-labelledby': 'watch-mark' }, ...chips),
      vision !== null && view.notice?.tone === 'quiet' && !watch.amber
        ? h('p', { class: 'pp-hint pp-hint--amber', role: 'status' }, vision)
        : notice(view.notice),
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

export function watchCard(view: WatchView, actions: WatchActions, index: number): HTMLElement {
  const state = stateOf(view.status);
  const pending = view.busy ? 'Un instant…' : null;
  const body: readonly (HTMLElement | null)[] =
    view.status.link !== 'linked'
      ? [
          linkForm(
            {
              draft: view.draft,
              notice: view.notice,
              busy: view.busy,
              revoked: view.status.link === 'revoked',
            },
            actions,
            'Relie l’extension une fois : tes relevés arrivent alors à ton nom.',
          ),
        ]
      : !view.status.allowed
        ? [
            text(
              'Le navigateur doit laisser Impera lire instagram.com, et seulement ce site. Rien n’est lu tant que tu ne lances pas la veille.',
            ),
            notice(view.notice),
            button('Autoriser et lancer', actions.allow, 'neon', { wide: true, pending }),
          ]
        : view.status.watch === null
          ? [
              text(
                'Tu regardes, l’extension note les posts que tu vois. Jamais un message, jamais un clic à ta place. Elle s’arrête seule au bout de 45 minutes.',
              ),
              notice(view.notice),
              button('Lancer la veille', actions.begin, 'neon', { wide: true, pending }),
            ]
          : watching(view, actions);
  return card(
    { id: 'watch', icon: 'eye', title: 'Veille Instagram', aside: pill(state.pill, state.label), index },
    body,
  );
}
