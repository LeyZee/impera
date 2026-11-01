// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { keepTabInside } from './focus';

afterEach(cleanup);

describe('keepTabInside', () => {
  it('goes round every control a dialog can hold: select, summary and a tab stop included', () => {
    render(
      <div role="dialog" aria-label="Fenêtre" onKeyDown={keepTabInside}>
        <select aria-label="Choix">
          <option>Un</option>
        </select>
        <details>
          <summary>Détails</summary>
        </details>
        <div tabIndex={0}>Dernier</div>
        <div tabIndex={-1}>Hors du tour</div>
      </div>,
    );
    const first = screen.getByLabelText('Choix');
    const last = screen.getByText('Dernier');

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
