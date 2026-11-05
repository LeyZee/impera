import { useEffect, type RefObject } from 'react';

/** Room kept between a revealed message and the edge of the panel, so it never sits flush against the glass. */
const MARGIN = 16;

interface Span {
  top: number;
  bottom: number;
}

/**
 * Where the panel must scroll to so `target` is fully in `view`, or null when it already is. It moves the least it
 * can (the message comes in at the nearest edge) and never past the message's own top.
 */
export function revealTop(view: Span, target: Span, scrollTop: number, margin = MARGIN): number | null {
  // A panel not laid out (hidden, or a test without layout) has nothing to scroll.
  if (view.bottom <= view.top) return null;
  const below = target.bottom - (view.bottom - margin);
  const above = view.top + margin - target.top;
  if (below > 0 && above < 0) return scrollTop + Math.min(below, -above);
  if (above > 0) return Math.max(0, scrollTop - above);
  return null;
}

/** What a dialog brings into view when it appears: a message about what failed. */
const ALERT = '[role="alert"]';

/**
 * Keeps what failed in sight: when an error appears inside the scrolling panel (a write refused, a field to fix)
 * below or above what is shown, the panel scrolls just enough to show the first one.
 */
export function useRevealAlerts(scroller: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const panel = scroller.current;
    if (panel === null) return;
    const observer = new MutationObserver((records) => {
      const added = records.flatMap((record) =>
        [...record.addedNodes].filter((node): node is Element => node instanceof Element),
      );
      const alert = added
        .flatMap((node) => (node.matches(ALERT) ? [node] : [...node.querySelectorAll(ALERT)]))
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0];
      if (alert === undefined) return;
      const top = revealTop(panel.getBoundingClientRect(), alert.getBoundingClientRect(), panel.scrollTop);
      if (top === null) return;
      const still =
        typeof window.matchMedia !== 'function' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollTo({ top, behavior: still ? 'auto' : 'smooth' });
    });
    observer.observe(panel, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, [scroller]);
}
