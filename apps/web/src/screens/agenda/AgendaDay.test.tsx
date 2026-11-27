// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddDialog, AgendaDay } from './AddDialog';
import { post, ZONE } from './fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(field);
    // Written as a day, but no calendar has it: said so, not how to write one (relecture des captures, #575).
    expect(screen.getByText('Ce jour n’existe pas.')).toBeDefined();
  });

  it('says how a day is written when what is typed is no day at all', () => {
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
    fireEvent.change(field, { target: { value: 'demain' } });
    fireEvent.blur(field);
    expect(screen.getByText('Un jour comme 28/03/2027, ou 28/3.')).toBeDefined();
  });
});

describe('AddDialog', () => {
  it('goes to the day of the task it added, so that she sees it (MOD-13)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(post), { status: 201 }))),
    );
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddDialog zone={ZONE} preset={{ day: '2026-11-03' }} onClose={onClose} onAdded={onAdded} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Quoi'), { target: { value: 'Story coulisses' } });
    fireEvent.submit(screen.getByLabelText('Quoi').closest('form') ?? document.body);
    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledWith('2026-11-03');
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
