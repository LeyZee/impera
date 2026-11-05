// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { useRef, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { revealTop, useRevealAlerts } from './reveal';

const VIEW = { top: 100, bottom: 500 };

describe('revealTop', () => {
  it('leaves the panel where it is when the message is already in sight', () => {
    expect(revealTop(VIEW, { top: 200, bottom: 240 }, 50)).toBeNull();
  });

  it('scrolls down just enough to show a message under the fold, with a margin', () => {
    expect(revealTop(VIEW, { top: 520, bottom: 560 }, 50)).toBe(50 + 560 - 484);
  });

  it('scrolls up to show a message above what is shown', () => {
    expect(revealTop(VIEW, { top: 40, bottom: 80 }, 300)).toBe(300 - 76);
  });

  it('never scrolls a tall message past its own top', () => {
    expect(revealTop(VIEW, { top: 300, bottom: 1000 }, 0)).toBe(300 - 116);
  });

  it('does nothing on a panel that is not laid out', () => {
    expect(revealTop({ top: 0, bottom: 0 }, { top: 0, bottom: 0 }, 0)).toBeNull();
  });
});

function Panel({ failed }: { failed: boolean }): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  useRevealAlerts(scroller);
  return (
    <div ref={scroller} data-testid="panel">
      <p>Le formulaire</p>
      {failed ? (
        <p role="alert" data-testid="alert">
          Ça n’est pas passé.
        </p>
      ) : null}
    </div>
  );
}

describe('useRevealAlerts', () => {
  it('brings a message about what failed into view when it appears below the fold', async () => {
    const { rerender } = render(<Panel failed={false} />);
    const panel = screen.getByTestId('panel');
    const scrollTo = vi.fn();
    panel.scrollTo = scrollTo;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this === panel
        ? DOMRect.fromRect({ x: 0, y: 100, width: 400, height: 400 })
        : DOMRect.fromRect({ x: 0, y: 520, width: 400, height: 40 });
    });

    rerender(<Panel failed />);
    await vi.waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 76, behavior: 'auto' });
    });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
