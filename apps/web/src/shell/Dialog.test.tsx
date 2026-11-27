// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLOSE_GUARD_MS, Dialog, isClickThrough } from './Dialog';

afterEach(cleanup);

describe('Dialog', () => {
  it('focuses its first field, and closes on Échap', () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Un shift" onClose={onClose}>
        <input aria-label="Début" />
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Début'));
    fireEvent.keyDown(screen.getByLabelText('Début'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('takes the focus itself when it holds nothing but its ×, so Échap still closes it (recette 16/11, CHT-20)', () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Palier Or" onClose={onClose}>
        <p>Pas encore gagné</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Palier Or' });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps Tab inside from the glass itself, both ways', () => {
    render(
      <Dialog title="Palier Or" onClose={vi.fn()}>
        <p>Pas encore gagné</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fermer' }));
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fermer' }));
  });

  it('does not close while a write is under way', () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Palier Or" busy onClose={onClose}>
        <p>…</p>
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('swallows a person’s click just after it closes, the end of a double click (CHAT-05, MOD-10)', () => {
    expect(isClickThrough({ isTrusted: true }, 120)).toBe(true);
    expect(isClickThrough({ isTrusted: true }, CLOSE_GUARD_MS)).toBe(false);
    // A script's click (a test's, an extension's) is never taken for the end of a gesture.
    expect(isClickThrough({ isTrusted: false }, 120)).toBe(false);
  });

  it('lets a click reach the page once it is closed when no person made it', () => {
    const { unmount } = render(
      <Dialog title="Palier Or" onClose={vi.fn()}>
        <p>Pas encore gagné</p>
      </Dialog>,
    );
    unmount();
    const onClick = vi.fn();
    const under = document.createElement('button');
    under.addEventListener('click', onClick);
    document.body.append(under);
    fireEvent.click(under);
    expect(onClick).toHaveBeenCalledOnce();
    under.remove();
  });
});
