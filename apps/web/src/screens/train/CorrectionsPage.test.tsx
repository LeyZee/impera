// @vitest-environment jsdom
import {
  ConversationIdSchema,
  DraftCorrectionsViewSchema,
  DraftIdSchema,
  type DraftCorrection,
  type DraftCorrectionsView,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CorrectionsPage } from './CorrectionsPage';

/* An invented creator and invented drafts (ADR 0010). */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const creatorId = id(1);

const line = (n: number, patch: Partial<DraftCorrection>): DraftCorrection => ({
  draftId: DraftIdSchema.parse(id(100 + n)),
  conversationId: ConversationIdSchema.parse(id(200 + n)),
  fanDisplayName: `Fan ${String(n)}`,
  at: '2026-11-20T21:00:00.000Z',
  kind: 'rejected',
  reason: 'none',
  note: null,
  before: ['Coucou toi', 'Tu fais quoi ce soir ?'],
  after: null,
  ...patch,
});

const VIEW: DraftCorrectionsView = DraftCorrectionsViewSchema.parse({
  creatorId,
  since: '2026-10-22T00:00:00.000Z',
  truncated: false,
  counts: [
    { reason: 'too_long', count: 1 },
    { reason: 'edited', count: 1 },
  ],
  items: [
    line(1, { reason: 'too_long', note: 'Trop de bulles' }),
    line(2, { kind: 'edited', reason: 'edited', after: ['Coucou toi 😘'] }),
  ],
});

let corrections: DraftCorrectionsView;
let asked: string[];

beforeEach(() => {
  corrections = VIEW;
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      asked.push(input);
      if (input.startsWith('/v1/creators/') && input.endsWith('/draft-corrections'))
        return Promise.resolve(new Response(JSON.stringify(corrections), { status: 200 }));
      return Promise.resolve(
        new Response(
          JSON.stringify({ creators: [{ id: creatorId, displayName: 'Nora', timezone: 'Europe/Paris' }] }),
          { status: 200 },
        ),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The page under a router: its fan links point at the Suivi. */
function renderPage(): void {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/', component: CorrectionsPage });
  const suivi = createRoute({ getParentRoute: () => root, path: '/suivi' });
  const router = createRouter({
    routeTree: root.addChildren([page, suivi]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('Entraîner › Corrections (trou béant 12)', () => {
  it('shows each correction with why, what the agent wrote beside what left, and filters by reason', async () => {
    renderPage();
    const cards = await screen.findAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(asked).toContain(`/v1/creators/${creatorId}/draft-corrections`);

    const [refused, edited] = cards;
    if (refused === undefined || edited === undefined) throw new Error('no cards');
    expect(within(refused).getByText('Trop long')).toBeTruthy();
    expect(within(refused).getByText('« Trop de bulles »')).toBeTruthy();
    expect(
      within(within(refused).getByRole('region', { name: 'Avant' })).getByText('Coucou toi'),
    ).toBeTruthy();
    expect(within(refused).getByText('Rien n’est parti de ce brouillon.')).toBeTruthy();
    expect(
      within(within(edited).getByRole('region', { name: 'Après' })).getByText('Coucou toi 😘'),
    ).toBeTruthy();
    expect(within(refused).getByRole('link', { name: 'Fan 1' }).getAttribute('href')).toContain('/suivi?');

    const reasons = screen.getByRole('group', { name: 'Raisons' });
    expect(within(reasons).getByRole('button', { name: 'Toutes · 2' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(reasons).getByRole('button', { name: 'Retouché · 1' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('Trop long')).toBeNull();
  });

  it('says when nothing was corrected', async () => {
    corrections = { ...VIEW, counts: [], items: [] };
    renderPage();
    expect(await screen.findByText('Aucun brouillon refusé ni retouché depuis 30 jours.')).toBeTruthy();
  });
});
