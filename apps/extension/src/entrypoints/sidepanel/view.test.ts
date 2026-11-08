// @vitest-environment jsdom
import {
  FAN_CARD_FIELDS,
  FanIdSchema,
  type FanCardEntry,
  type FanCardValue,
  type FanCardView,
} from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import { render, type PanelActions, type PanelScreen } from './view';

/* An invented fan (ADR 0010). */
const now = new Date('2026-11-08T18:00:00Z');
const value = (items: string[], patch: Partial<FanCardValue> = {}): FanCardValue => ({
  items,
  source: 'declared',
  observedAt: '2026-11-05T18:00:00Z',
  notedBy: null,
  notedByName: null,
  sourceMessageId: null,
  sourceQuote: null,
  ...patch,
});

function card(entries: Partial<Record<FanCardEntry['field'], Omit<FanCardEntry, 'field'>>>): FanCardView {
  return {
    fanId: FanIdSchema.parse('0199f2a0-0000-7000-8000-000000000003'),
    fields: FAN_CARD_FIELDS.map((spec) => ({
      field: spec.field,
      current: null,
      toCheck: [],
      ...entries[spec.field],
    })),
    others: [],
  };
}

function draw(screen: PanelScreen): { root: HTMLElement; actions: PanelActions } {
  const actions: PanelActions = { openCrm: vi.fn(), toggleGroup: vi.fn() };
  const root = document.createElement('main');
  render(root, screen, actions);
  return { root, actions };
}

const onCard = (view: FanCardView, open: string[] = []): PanelScreen => ({
  kind: 'conversation',
  cardOn: true,
  card: view,
  openGroups: new Set(open.filter((g) => g === 'him' || g === 'about_her' || g === 'intimate')),
  now,
});

describe('the copilot side panel (ADR 0086, lot b)', () => {
  it.each([
    ['no_conversation', 'Ouvre une conversation dans Reveal'],
    ['unknown', 'Impera n’a pas encore lu cette conversation'],
    ['off_shift', 'Tu n’es pas en poste sur cette créatrice'],
    ['down', 'Le CRM ne répond pas'],
  ] as const)('says %s in one line', (kind, title) => {
    expect(draw({ kind }).root.querySelector('.cp-notice__title')?.textContent).toBe(title);
  });

  it('offers the CRM when the session is gone', () => {
    const { root, actions } = draw({ kind: 'signed_out' });
    root.querySelector<HTMLButtonElement>('[data-action="crm"]')?.click();
    expect(actions.openCrm).toHaveBeenCalledOnce();
  });

  it('puts the essentials on top, read in three seconds, his words as text', () => {
    const { root } = draw(
      onCard(
        card({
          first_name: { current: value(['Marc']), toCheck: [] },
          location: { current: value(['Lyon'], { source: 'noted', notedByName: 'Inès' }), toCheck: [] },
          desires: {
            current: value(['qu’elle le domine'], {
              source: 'inferred',
              sourceQuote: '<b>j’adore</b> quand tu décides',
            }),
            toCheck: [],
          },
        }),
      ),
    );
    const essentials = [...root.querySelectorAll('.cp-fields--essentials .cp-field__label')].map(
      (n) => n.textContent,
    );
    expect(essentials).toEqual([
      'Son prénom',
      'Son âge',
      'Sa ville ou sa région',
      'Ses fantasmes',
      'Ce qu’il ne veut pas',
      'Ce qui se passe dans sa vie',
    ]);
    const town = root.querySelector('[data-field="location"]');
    expect(town?.querySelector('.cp-field__value')?.textContent).toBe('Lyon');
    expect(town?.querySelector('.cp-field__source')?.textContent).toBe('Noté par Inès, il y a 3 jours');
    const quote = root.querySelector('[data-field="desires"] q');
    expect(quote?.textContent).toBe('<b>j’adore</b> quand tu décides');
    expect(quote?.querySelector('b')).toBeNull();
    expect(root.querySelector('[data-field="age"] .cp-field__empty')?.textContent).toBe('Pas encore su');
  });

  it('folds the rest by group, keeps the groups he opened, and says what waits for a chatter in amber', () => {
    const { root, actions } = draw(
      onCard(
        card({
          job: {
            current: value(['infirmier'], { source: 'noted' }),
            toCheck: [value(['aide-soignant'], { source: 'inferred' })],
          },
        }),
        ['about_her'],
      ),
    );
    const groups = [...root.querySelectorAll<HTMLDetailsElement>('details.cp-group')];
    expect(groups.map((g) => [g.dataset['group'], g.open])).toEqual([
      ['him', false],
      ['about_her', true],
      ['intimate', false],
    ]);
    expect(root.querySelector('.cp-head__check')?.textContent).toBe('1 à vérifier');
    expect(root.querySelector('[data-field="job"] .cp-field__check')?.textContent).toBe(
      'À vérifier : l’agent a lu « aide-soignant »',
    );
    const him = groups[0];
    if (him === undefined) throw new Error('no group');
    him.open = true;
    him.dispatchEvent(new Event('toggle'));
    expect(actions.toggleGroup).toHaveBeenCalledWith('him', true);
  });

  it('says the card is off for her, and never draws it', () => {
    const { root } = draw({
      kind: 'conversation',
      cardOn: false,
      card: card({}),
      openGroups: new Set(),
      now,
    });
    expect(root.querySelector('.cp-notice__title')?.textContent).toBe(
      'La fiche du fan est éteinte pour cette créatrice',
    );
    expect(root.querySelector('.cp-field')).toBeNull();
  });
});
