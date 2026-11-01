import { useEffect, useRef, type RefObject } from 'react';

/**
 * Whether the end of the thread is in view, kept up to date as the person scrolls. Without IntersectionObserver
 * (jsdom), the end counts as in view, as the reader opens there.
 */
export function useEndInView(endRef: RefObject<HTMLDivElement | null>): RefObject<boolean> {
  const inView = useRef(true);
  useEffect(() => {
    const end = endRef.current;
    if (end === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) inView.current = entry.isIntersecting;
    });
    observer.observe(end);
    return () => {
      observer.disconnect();
    };
  }, [endRef]);
  return inView;
}

/**
 * Shows the end of the thread, and the waiting draft under it. From 900 px the thread has its own scroll and the draft
 * sits pinned under it (`tracking.css`): only the thread moves, to its last message, never the page, even when the
 * thread is shorter than its box. On a phone, where the reader is the whole screen, the page scrolls to the draft, else
 * to the end; the draft keeps the tab bar's room under it (`scroll-margin-bottom`). The choice follows the thread's
 * computed overflow, so it follows the CSS.
 */
export function bringIntoView(
  body: HTMLElement | null,
  draft: HTMLElement | null,
  end: HTMLElement | null,
): void {
  if (body === null) return;
  if (getComputedStyle(body).overflowY === 'auto') {
    body.scrollTop = body.scrollHeight;
    return;
  }
  (draft ?? end)?.scrollIntoView({ block: 'nearest' });
}
