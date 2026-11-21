import { tipPlacement } from '@impera/design-system';

import { h } from '../../lib/dom';

/**
 * The design system's floating tip (`.nv-tip`), for the popup: it opens on hover and on keyboard focus alike, closes on
 * leave, blur or Escape, and only ever repeats a detail the card already implies (avis Design du 19/11). One at a time.
 */

interface TipRow {
  readonly label: string;
  readonly value: string;
}

export interface TipContent {
  readonly title: string;
  readonly rows: readonly TipRow[];
}

let counter = 0;

function tipOf(content: TipContent, id: string): HTMLElement {
  return h(
    'div',
    { class: 'nv-tip nv-glass', role: 'tooltip', id },
    h('p', { class: 'nv-tip__title' }, content.title),
    ...content.rows.map((row) =>
      h('div', { class: 'nv-tip__row' }, h('span', {}, row.label), h('b', {}, row.value)),
    ),
  );
}

/** Makes `target` focusable and gives it its tip, below it, kept inside the popup. */
export function withTip<T extends HTMLElement>(target: T, content: TipContent): T {
  counter += 1;
  const id = `pp-tip-${String(counter)}`;
  target.setAttribute('tabindex', '0');
  target.setAttribute('aria-describedby', id);
  target.classList.add('pp-tipped');
  let open: HTMLElement | null = null;
  const close = (): void => {
    open?.remove();
    open = null;
  };
  const show = (): void => {
    if (open !== null) return;
    document.querySelectorAll('.nv-tip').forEach((other) => {
      other.remove();
    });
    const tip = tipOf(content, id);
    document.body.append(tip);
    const box = target.getBoundingClientRect();
    const place = tipPlacement(
      { x: box.left, y: box.bottom },
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { offset: 6, pad: 8 },
    );
    tip.style.left = `${String(place.left)}px`;
    tip.style.top = `${String(place.top)}px`;
    open = tip;
    requestAnimationFrame(() => {
      tip.classList.add('is-on');
    });
  };
  target.addEventListener('pointerenter', show);
  target.addEventListener('focus', show);
  target.addEventListener('pointerleave', close);
  target.addEventListener('blur', close);
  target.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  return target;
}
