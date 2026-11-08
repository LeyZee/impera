// @vitest-environment jsdom
import {
  FAN_CARD_FIELDS,
  FanIdSchema,
  type FanCardEntry,
  type FanCardValue,
  type FanCardView,
} from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import { standingOf } from '../../lib/copilot/standing';

import { render, type DraftPart, type PanelActions, type PanelScreen } from './view';

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
  const actions: PanelActions = {
    openCrm: vi.fn(),
    toggleGroup: vi.fn(),
    place: vi.fn(),
    edit: vi.fn(),
    editText: vi.fn(),
    reject: vi.fn(),
    pickReason: vi.fn(),
    sendReject: vi.fn(),
    cancel: vi.fn(),
  };
  const root = document.createElement('main');
  render(root, screen, actions);
  return { root, actions };
}

const onCard = (
  view: FanCardView,
  open: string[] = [],
  patch: { draft?: DraftPart; standing?: PanelScreenStanding } = {},
): PanelScreen => ({
  kind: 'conversation',
  standing: patch.standing ?? standingOf({}, null),
  cardOn: true,
  card: view,
  openGroups: new Set(open.filter((g) => g === 'him' || g === 'about_her' || g === 'intimate')),
  draft: patch.draft ?? { kind: 'hidden' },
  now,
});
type PanelScreenStanding = Extract<PanelScreen, { kind: 'conversation' }>['standing'];

const ready = (patch: Partial<Extract<DraftPart, { kind: 'ready' }>> = {}): DraftPart => ({
  kind: 'ready',
  bubbles: ['coucou toi 😘', 'tu rentres quand de ta garde ?'],
  placed: false,
  mode: 'idle',
  text: '',
  reason: null,
  done: null,
  ...patch,
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
    const screen = onCard(card({}));
    if (screen.kind !== 'conversation') throw new Error('not a conversation');
    const { root } = draw({ ...screen, cardOn: false });
    expect(root.querySelector('.cp-notice__title')?.textContent).toBe(
      'La fiche du fan est éteinte pour cette créatrice',
    );
    expect(root.querySelector('.cp-field')).toBeNull();
  });

  it('says where things stand in one line: red forbids, amber holds back, then his desire', () => {
    const line = (screen: PanelScreen): string | null | undefined =>
      draw(screen).root.querySelector('.cp-standing')?.textContent;
    const { root } = draw(
      onCard(card({}), [], {
        standing: standingOf(
          { salesFrozen: { reason: 'distress', since: now.toISOString() }, fragile: true },
          'playful',
        ),
      }),
    );
    expect(root.querySelector('.cp-standing__stop')?.textContent).toBe('Ventes gelées');
    expect(root.querySelector('.cp-standing__care')?.textContent).toBe('Fan fragile');
    expect(root.querySelector('.cp-standing')?.textContent).toBe('Ventes gelées·Fan fragile·désir joueur 😏');
    expect(line(onCard(card({}), [], { standing: standingOf({}, 'neutral') }))).toBe(
      'Rien à signaler·désir neutre',
    );
    expect(line(onCard(card({}), [], { standing: standingOf('unread', null) }))).toBe('Limites non lues');
    expect(line(onCard(card({}), [], { standing: standingOf({ spendingLimitMinor: 15_000 }, null) }))).toBe(
      'Plafond 150\u00a0€',
    );
  });

  it('shows no draft when her drafts are off or none waits, and « L’agent écrit… » while it writes', () => {
    expect(draw(onCard(card({}))).root.querySelector('.cp-draft')).toBeNull();
    const writing = draw(onCard(card({}), [], { draft: { kind: 'writing' } })).root;
    expect(writing.querySelector('.cp-draft')?.textContent).toBe('L’agent écrit…');
  });

  it('puts the draft at the foot, under the card, with its three gestures and their keys', () => {
    const { root, actions } = draw(onCard(card({}), [], { draft: ready() }));
    // The card scrolls between the line on top and the draft at the foot: a draft pushes nothing (§ 10).
    expect([...root.children].map((node) => node.className)).toEqual([
      'cp-standing',
      'cp-scroll',
      'cp-draft',
    ]);
    expect([...root.querySelectorAll('.cp-bubble')].map((n) => n.textContent)).toEqual([
      'coucou toi 😘',
      'tu rentres quand de ta garde ?',
    ]);
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.cp-draft__actions button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Envoyer A', 'Retoucher E', 'Refuser R']);
    buttons[0]?.click();
    buttons[1]?.click();
    buttons[2]?.click();
    expect(actions.place).toHaveBeenCalledWith(false);
    expect(actions.edit).toHaveBeenCalledOnce();
    expect(actions.reject).toHaveBeenCalledOnce();
  });

  it('retouches in a field, one bubble per line, and places the retouched text', () => {
    const { root, actions } = draw(
      onCard(card({}), [], { draft: ready({ mode: 'editing', text: 'coucou toi 😘\ntu rentres quand ?' }) }),
    );
    const area = root.querySelector<HTMLTextAreaElement>('textarea');
    expect(area?.value).toBe('coucou toi 😘\ntu rentres quand ?');
    root.querySelector<HTMLButtonElement>('[data-gesture="place-edited"]')?.click();
    expect(actions.place).toHaveBeenCalledWith(true);
  });

  it('refuses with a reason of the closed list and an optional note, the button shut until a reason', () => {
    const shut = draw(onCard(card({}), [], { draft: ready({ mode: 'rejecting' }) })).root;
    expect(shut.querySelector<HTMLButtonElement>('[data-gesture="send-reject"]')?.disabled).toBe(true);
    const { root, actions } = draw(
      onCard(card({}), [], { draft: ready({ mode: 'rejecting', reason: 'too_long' }) }),
    );
    expect(root.querySelector('[aria-checked="true"]')?.textContent).toBe('Trop long');
    root.querySelector<HTMLButtonElement>('[data-reason="sounds_ai"]')?.click();
    expect(actions.pickReason).toHaveBeenCalledWith('sounds_ai');
    const note = root.querySelector<HTMLInputElement>('.cp-draft__note');
    if (note !== null) note.value = 'trop poli';
    root.querySelector<HTMLButtonElement>('[data-gesture="send-reject"]')?.click();
    expect(actions.sendReject).toHaveBeenCalledWith('trop poli');
  });

  it('says what is left to do in Reveal, and in amber when the gesture did not count', () => {
    const placed = draw(
      onCard(card({}), [], {
        draft: ready({ done: { outcome: 'placed', copyFailed: false, sent: 'sent' } }),
      }),
    ).root;
    expect(placed.querySelector('.cp-draft__next')?.textContent).toBe(
      'Texte copié : colle-le dans Reveal (Ctrl+V), relis, et envoie.',
    );
    expect(placed.querySelector('.cp-draft__actions')).toBeNull();
    expect(placed.querySelector('.cp-draft__warn')).toBeNull();
    const unlinked = draw(
      onCard(card({}), [], {
        draft: ready({ done: { outcome: 'rejected', copyFailed: false, sent: 'unlinked' } }),
      }),
    ).root;
    expect(unlinked.querySelector('.cp-draft__warn')?.textContent).toBe(
      'Ce geste n’a pas compté : relie l’extension dans son popup (« Relier »).',
    );
  });
});
