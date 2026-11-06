// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AgendaDay } from './AddDialog';

afterEach(cleanup);

// Recette des dates: « Ajouter » stays off while the day does not read, and nothing said why.
describe('AgendaDay', () => {
  it('says what a day is once its field is left, not at the first digit', () => {
    render(
      <AgendaDay
        value="2026-11-20"
        tried={false}
        onChange={() => undefined}
        onUnreadable={() => undefined}
      />,
    );
    const field = screen.getByLabelText('Jour');
    field.focus();
    fireEvent.change(field, { target: { value: '31/02' } });
    expect(screen.queryByText('Un jour comme 28/03/2027, ou 28/3.')).toBeNull();
    fireEvent.blur(field);
    expect(screen.getByText('Un jour comme 28/03/2027, ou 28/3.')).toBeDefined();
  });
});
