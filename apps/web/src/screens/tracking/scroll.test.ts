// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { bringIntoView } from './scroll';

/** An element with the sizes jsdom does not lay out, and a spy on its own scrollIntoView. */
function box(sizes: { scrollHeight?: number; clientHeight?: number; top?: number; ownScroll?: boolean }): {
  element: HTMLElement;
  scrolledIntoView: ReturnType<typeof vi.fn>;
} {
  const element = document.createElement('div');
  // What tracking.css gives the thread from 900 px.
  if (sizes.ownScroll === true) element.style.overflowY = 'auto';
  Object.defineProperty(element, 'scrollHeight', { value: sizes.scrollHeight ?? 0 });
  Object.defineProperty(element, 'clientHeight', { value: sizes.clientHeight ?? 0 });
  element.getBoundingClientRect = () => DOMRect.fromRect({ y: sizes.top ?? 0, height: 0 });
  const scrolledIntoView = vi.fn();
  element.scrollIntoView = scrolledIntoView;
  return { element, scrolledIntoView };
}

describe('bringIntoView', () => {
  it('scrolls the thread alone when it scrolls on its own, never the page', () => {
    const body = box({ scrollHeight: 2000, clientHeight: 500, top: 100, ownScroll: true });
    const end = box({});
    bringIntoView(body.element, null, end.element);
    expect(body.element.scrollTop).toBe(2000);
    expect(end.scrolledIntoView).not.toHaveBeenCalled();
  });

  it('keeps the thread on its last message when a draft waits pinned under it', () => {
    const body = box({ scrollHeight: 2000, clientHeight: 500, top: 100, ownScroll: true });
    body.element.scrollTop = 300;
    const draft = box({ top: 700 });
    bringIntoView(body.element, draft.element, box({}).element);
    expect(body.element.scrollTop).toBe(2000);
    expect(draft.scrolledIntoView).not.toHaveBeenCalled();
  });

  it('never moves the page on a wide screen, even when the thread is shorter than its box', () => {
    const body = box({ scrollHeight: 300, clientHeight: 300, ownScroll: true });
    const end = box({});
    bringIntoView(body.element, null, end.element);
    expect(end.scrolledIntoView).not.toHaveBeenCalled();
  });

  it('lets the page scroll on a phone, where the thread has no scroll of its own', () => {
    const body = box({ scrollHeight: 2000, clientHeight: 500 });
    const draft = box({});
    bringIntoView(body.element, draft.element, box({}).element);
    expect(draft.scrolledIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
