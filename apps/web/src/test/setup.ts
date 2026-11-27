import { configure } from '@testing-library/dom';

/*
 * How long `findBy…` and `waitFor` wait before they fail. The library's 1 s is spent by a loaded machine (the pre-push
 * runs the web and the API suites side by side on a laptop) before the screen has rendered, and a right screen fails.
 * Waiting longer changes no assertion: a screen that never shows what is asked still fails, only later.
 */
configure({ asyncUtilTimeout: 5_000 });

/* jsdom lays nothing out and has no `scrollIntoView`: the design system's list keeps its active choice in view with it. */
if (typeof Element !== 'undefined') Element.prototype.scrollIntoView = (): void => undefined;

/*
 * jsdom has no `ResizeObserver` and no `matchMedia`: a screen that watches its size or a media query would write a
 * React error on every test that draws it (CODE-09). A test that needs a given answer stubs its own.
 */
if (typeof window !== 'undefined') {
  if (typeof window.ResizeObserver === 'undefined') {
    window.ResizeObserver = class {
      observe = (): undefined => undefined;
      unobserve = (): undefined => undefined;
      disconnect = (): undefined => undefined;
    };
  }
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList => {
      const list = new EventTarget();
      return Object.assign(list, {
        matches: false,
        media: query,
        onchange: null,
        addListener: (): void => undefined,
        removeListener: (): void => undefined,
      });
    };
  }
}
