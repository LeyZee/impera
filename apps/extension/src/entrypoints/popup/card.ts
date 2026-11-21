import { h } from '../../lib/dom';
import { icon, type IconName } from '../../lib/icons';

/**
 * The popup's one grammar for a card about the open tab (recette visuelle du 16/11, V-EXT-09 to 11): a head with its
 * picture in a 40 px tile, its title and, on the right, a pill or one button; then the body across the whole width,
 * its parts split by a hairline. The copilot, the Reveal session, the watch and the away card all take it.
 */

export type PillKind = 'sent' | 'idle' | 'error' | 'awaiting-approval';

export function pill(kind: PillKind, label: string): HTMLElement {
  return h(
    'span',
    { class: `nv-status nv-status--${kind} pp-pill`, role: 'status' },
    h('span', { class: 'nv-status__dot', 'aria-hidden': 'true' }),
    label,
  );
}

type Child = HTMLElement | null;

export interface CardHead {
  readonly id: string;
  /** A glyph of the set, or a drawn mark that fills the tile (Reveal's eyes). */
  readonly icon: IconName | SVGSVGElement;
  readonly title: string;
  /** A pill or a button, on the right of the title. */
  readonly aside?: HTMLElement | null;
  /** The order of its entrance, after the account. */
  readonly index: number;
}

export function card(head: CardHead, ...body: readonly (Child | readonly Child[])[]): HTMLElement {
  const parts = body.flat().filter((part): part is HTMLElement => part !== null);
  return h(
    'section',
    {
      class: 'pp-card nv-plate nv-enter',
      style: `--nv-i: ${String(head.index)}`,
      'data-card': head.id,
      'aria-labelledby': `${head.id}-title`,
    },
    h(
      'header',
      { class: 'pp-card__head' },
      typeof head.icon === 'string'
        ? h('span', { class: 'pp-card__icon', 'aria-hidden': 'true' }, icon(head.icon, 18))
        : h('span', { class: 'pp-card__icon pp-card__icon--mark', 'aria-hidden': 'true' }, head.icon),
      h('h2', { class: 'pp-card__title', id: `${head.id}-title` }, head.title),
      head.aside ?? null,
    ),
    parts.length === 0 ? null : h('div', { class: 'pp-card__body' }, ...parts),
  );
}

/** A part of the body below a hairline: the « Relier » under the copilot. */
export function part(...children: readonly Child[]): HTMLElement {
  return h('div', { class: 'pp-card__part' }, ...children);
}

/** A sentence of the card. */
export function text(content: string): HTMLElement {
  return h('p', { class: 'pp-card__text' }, content);
}

export interface ButtonOptions {
  readonly wide?: boolean;
  /** Something is on its way: every button of the card waits. */
  readonly busy?: boolean;
  /** This button's own gesture is the one on its way: it says so (V-EXT-16). */
  readonly pending?: string | null;
  readonly type?: 'button' | 'submit';
  /** Takes the focus when the card is drawn: the safe choice of a confirmation. */
  readonly focus?: boolean;
  /** A neon inside a row of equal buttons keeps their height (popup-recette-1, image 05). */
  readonly small?: boolean;
}

/**
 * A button of the popup. The neon is the screen's one action and keeps the full height (V-EXT-04); soft and plain
 * buttons inside a card are the small ones.
 */
export function button(
  label: string,
  onClick: () => void,
  variant: 'neon' | 'soft' | 'plain',
  options: ButtonOptions = {},
): HTMLButtonElement {
  const pending = options.pending ?? null;
  const element = h(
    'button',
    {
      type: options.type ?? 'button',
      class: [
        'nv-btn',
        `nv-btn--${variant}`,
        variant === 'neon' && options.small !== true ? '' : 'nv-btn--sm',
        'pp-btn',
        options.wide === true ? 'pp-wide' : '',
      ]
        .filter((name) => name !== '')
        .join(' '),
      disabled: options.busy === true || pending !== null,
      'aria-busy': pending === null ? undefined : 'true',
      'data-autofocus': options.focus === true ? 'true' : undefined,
    },
    h('span', {}, pending ?? label),
  );
  if (options.type !== 'submit') element.addEventListener('click', onClick);
  return element;
}

/** A link of the card, in ink with its chevron so that it reads as one (popup-recette-2, Design). */
export function goLink(label: string, onClick: () => void): HTMLButtonElement {
  const element = h(
    'button',
    { type: 'button', class: 'pp-link pp-link--go' },
    h('span', {}, label),
    icon('chevronRight', 14),
  );
  element.addEventListener('click', onClick);
  return element;
}
