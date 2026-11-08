// @vitest-environment jsdom
import {
  FAN_CARD_FIELDS,
  FanIdSchema,
  SetFanCardFieldBodySchema,
  type FanCardEntry,
  type FanCardValue,
  type FanCardView,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FanCard } from './FanCard';

/* An invented fan and creator (ADR 0010). */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const creatorId = id(1);
const fanId = FanIdSchema.parse(id(2));

const value = (items: string[], patch: Partial<FanCardValue> = {}): FanCardValue => ({
  items,
  source: 'declared',
  observedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  notedBy: null,
  notedByName: null,
  sourceMessageId: null,
  sourceQuote: null,
  ...patch,
});

function card(entries: Partial<Record<FanCardEntry['field'], Omit<FanCardEntry, 'field'>>>): FanCardView {
  return {
    fanId,
    fields: FAN_CARD_FIELDS.map((spec) => ({
      field: spec.field,
      current: null,
      toCheck: [],
      ...entries[spec.field],
    })),
    others: [],
  };
}

let view: FanCardView;
let puts: { path: string; body: unknown }[];
let answer: { status: number; body: unknown } | null;

beforeEach(() => {
  puts = [];
  answer = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        puts.push({ path: input, body });
        if (answer !== null)
          return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
        const parsed = SetFanCardFieldBodySchema.parse(body);
        const field = input.split('/card/')[1]?.split('?')[0];
        view = {
          ...view,
          fields: view.fields.map((entry) =>
            entry.field === field
              ? {
                  field: entry.field,
                  current: 'clear' in parsed ? null : value(parsed.items, { source: 'noted' }),
                  toCheck: [],
                }
              : entry,
          ),
        };
      }
      return Promise.resolve(new Response(JSON.stringify(view), { status: 200 }));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCard(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FanCard creatorId={creatorId} fanId={fanId} />
    </QueryClientProvider>,
  );
}

const group = async (title: string): Promise<HTMLElement> => {
  const titles = await screen.findAllByText(title, { selector: '.tr-limits__title' });
  const details = titles[0]?.closest('details') ?? null;
  if (details === null) throw new Error(`No group ${title}`);
  details.open = true;
  return details;
};

const field = (within_: HTMLElement, label: RegExp): HTMLElement => {
  const row = within(within_).getByText(label).closest<HTMLElement>('.tr-card__field');
  if (row === null) throw new Error('No row');
  return row;
};

describe('Suivi › Fiche du fan › ce qu’on sait de lui (ADR 0085, lot c)', () => {
  it('shows each group folded with how full it is, and a value with where it comes from', async () => {
    view = card({
      first_name: { current: value(['Marc']), toCheck: [] },
      payday: {
        current: value(['début du mois'], {
          source: 'inferred',
          sourceQuote: 'je suis payé le 1er, on verra',
        }),
        toCheck: [],
      },
    });
    renderCard();
    const him = await group('Lui');
    expect(within(him).getByText('2 sur 13')).toBeTruthy();
    const name = field(him, /^Son prénom/u);
    expect(within(name).getByText('Marc')).toBeTruthy();
    expect(within(name).getByText('Dit par lui, il y a 3 jours')).toBeTruthy();
    expect(within(field(him, /^Quand il a de l’argent/u)).getByText('Deviné, il y a 3 jours')).toBeTruthy();
    // A guess shows his words it rests on, as his words.
    expect(
      within(field(him, /^Quand il a de l’argent/u)).getByText('je suis payé le 1er, on verra').tagName,
    ).toBe('Q');
    expect(within(field(him, /^Son métier/u)).getByText('Pas encore su')).toBeTruthy();
    expect(within(field(him, /^Ses humeurs fréquentes/u)).getByText('Pas encore deviné')).toBeTruthy();
  });

  it('corrects a field in one gesture and shows the card the server answers', async () => {
    view = card({ location: { current: value(['Lyon']), toCheck: [] } });
    renderCard();
    const him = await group('Lui');
    const row = field(him, /^Sa ville ou sa région/u);
    fireEvent.click(within(row).getByRole('button', { name: 'Corriger' }));
    const input = within(row).getByRole('textbox', { name: 'Sa ville ou sa région' });
    fireEvent.change(input, { target: { value: ' Villeurbanne ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await within(row).findByText('Villeurbanne')).toBeTruthy();
    expect(puts).toEqual([
      {
        path: `/v1/fans/${fanId}/card/location?creatorId=${creatorId}`,
        body: { items: ['Villeurbanne'] },
      },
    ]);
    expect(within(row).getByText(/^Noté par un chatteur/u)).toBeTruthy();
  });

  it('writes a list one item per line, and keeps the save shut on an empty field', async () => {
    view = card({});
    renderCard();
    const her = await group('Ce qu’il aime chez elle');
    const row = field(her, /^Les tenues qu’il aime la voir porter/u);
    fireEvent.click(within(row).getByRole('button', { name: 'Ajouter' }));
    expect(within(row).getByRole('button', { name: 'Enregistrer' })).toHaveProperty('disabled', true);
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'lingerie noire\n\ncosplay' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(row).findByText('lingerie noire · cosplay')).toBeTruthy();
    expect(puts[0]?.body).toEqual({ items: ['lingerie noire', 'cosplay'] });
  });

  it('sets a closed value in one tap', async () => {
    view = card({});
    renderCard();
    const intimate = await group('Intime');
    const row = field(intimate, /^L’intensité qu’il cherche/u);
    fireEvent.click(within(row).getByRole('radio', { name: 'Coquin' }));
    await act(() => Promise.resolve());
    expect(puts[0]?.body).toEqual({ items: ['naughty'] });
    expect((await within(row).findByRole('radio', { name: 'Coquin' })).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('shows what the AI read against a chatter’s note in amber, and keeps one or the other in one gesture', async () => {
    view = card({
      job: {
        current: value(['infirmier'], { source: 'noted' }),
        toCheck: [value(['aide-soignant'], { source: 'inferred' })],
      },
    });
    renderCard();
    const him = await group('Lui');
    expect(within(him).getByText('1 à vérifier ·')).toBeTruthy();
    const check = within(field(him, /^Son métier/u)).getByRole('group', { name: 'Son métier : à vérifier' });
    expect(within(check).getByText(/« aide-soignant »/u)).toBeTruthy();
    fireEvent.click(within(check).getByRole('button', { name: 'Garder la note' }));
    await act(() => Promise.resolve());
    expect(puts[0]?.body).toEqual({ items: ['infirmier'] });
    expect(within(him).queryByRole('group', { name: 'Son métier : à vérifier' })).toBeNull();
  });

  it('says why a value is refused, and writes nothing', async () => {
    view = card({});
    answer = {
      status: 422,
      body: { error: { code: 'fan_card_value_unprocessable', message: 'x', requestId: 'r' } },
    };
    renderCard();
    const him = await group('Lui');
    const row = field(him, /^Sa ville ou sa région/u);
    fireEvent.click(within(row).getByRole('button', { name: 'Ajouter' }));
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: '12 rue des Lilas' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Enregistrer' }));
    expect((await within(row).findByRole('alert')).textContent).toBe(
      'La fiche ne garde ni adresse, ni numéro, ni e‑mail, ni compte ailleurs : rien n’a été écrit.',
    );
    expect(within(row).getByRole('textbox')).toBeTruthy();
  });
});
