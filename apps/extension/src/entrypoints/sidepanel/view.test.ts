// @vitest-environment jsdom
import {
  FAN_CARD_FIELDS,
  FanIdSchema,
  type CopilotAssist,
  type FanCardEntry,
  type FanCardValue,
  type FanCardView,
} from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import { standingOf, type Standing } from '../../lib/copilot/standing';

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
    toggleSale: vi.fn(),
    toggleDiscover: vi.fn(),
    showSignals: vi.fn(),
    place: vi.fn(),
    copyNext: vi.fn(),
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
  patch: {
    draft?: DraftPart;
    standing?: PanelScreenStanding;
    fanName?: string | null;
    newSince?: string | null;
    now?: Date;
    assist?: CopilotAssist | null;
    saleOpen?: boolean;
    discoverOpen?: boolean;
    signalsOpen?: boolean;
  } = {},
): PanelScreen => ({
  kind: 'conversation',
  fanName: patch.fanName ?? null,
  standing: patch.standing === undefined ? standingOf({}, null) : patch.standing,
  cardOn: true,
  opensCreators: true,
  card: view,
  openGroups: new Set(open.filter((g) => g === 'him' || g === 'about_her' || g === 'intimate')),
  newSince: patch.newSince ?? null,
  draft: patch.draft ?? { kind: 'hidden' },
  assist: patch.assist ?? null,
  saleOpen: patch.saleOpen ?? false,
  discoverOpen: patch.discoverOpen ?? false,
  signalsOpen: patch.signalsOpen ?? false,
  now: patch.now ?? now,
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

/* The agent's view (ADR 0141, lot a), invented (ADR 0010). */
const assistOf = (patch: Partial<CopilotAssist> = {}): CopilotAssist => ({
  nextMove: {
    kind: 'offer_step',
    label: 'Proposer «\u00a0Étape 3\u00a0» à 15 €',
    priceMinor: 1500,
    block: null,
  },
  reasons: [{ code: 'rewritten_once', label: 'Réécrit une fois par une garde' }],
  sale: {
    script: { name: 'Soirée d’essai', stepIndex: 1, stepCount: 4 },
    nextStep: { name: 'Étape 3', priceMinor: 1500 },
    refusedSteps: ['Étape 2 bis'],
    usedObjections: ['C’est trop cher'],
    customOrderOpen: false,
    offerPending: false,
  },
  signals: { desireTrend: null, followUpDue: false },
  cuts: [],
  buttons: ['hooks', 'objection'],
  clicksLeftToday: 30,
  ...patch,
});

/** The band's badges as a screen reader says them (Design 16/11, lot 0141-3). */
const badgeLabels = (root: ParentNode): (string | null)[] =>
  [...root.querySelectorAll('.cp-badge')].map((node) => node.getAttribute('aria-label'));

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
    const essentials = [...root.querySelectorAll('.cp-fields--essentials > .cp-field')].map((n) =>
      n.getAttribute('data-field'),
    );
    // Only what is known (Design 16/11, lot 0141-3): no « Pas encore su » line in the brief.
    expect(essentials).toEqual(['identity', 'desires']);
    const quote = root.querySelector('[data-field="desires"] q');
    expect(quote?.textContent).toBe('<b>j’adore</b> quand tu décides');
    expect(quote?.querySelector('b')).toBeNull();
    expect(root.querySelector('.cp-brief')?.textContent).not.toContain('Pas encore');
    // What he likes as short bullets, one per item.
    expect(root.querySelectorAll('[data-field="desires"] .cp-items > li')).toHaveLength(1);
    expect(draw(onCard(card({}))).root.querySelector('.cp-brief__none')?.textContent).toBe(
      'Rien de su sur lui pour l’instant.',
    );
  });

  // Recette du 16/11, EXT-04: prénom, âge et ville took nine lines, the same source said six times.
  it('says who he is in one line, its source once, and each other field in two lines', () => {
    const ident = (view: FanCardView): Element | null =>
      draw(onCard(view)).root.querySelector('[data-field="identity"]');
    const same = ident(
      card({
        first_name: { current: value(['Alpha']), toCheck: [] },
        age: { current: value(['34']), toCheck: [] },
        location: { current: value(['Lyon']), toCheck: [] },
      }),
    );
    expect(same?.querySelector('.cp-ident__line')?.textContent).toBe('Alpha·34 ans·Lyon');
    // Nothing in bold but the first name (Design 16/11, lot 0141-3).
    expect(same?.querySelector('.cp-ident__name')?.textContent).toBe('Alpha');
    expect([...(same?.querySelectorAll('.cp-ident__source') ?? [])].map((n) => n.textContent)).toEqual([
      'Dit par lui, il y a 3 jours',
    ]);
    const mixed = ident(
      card({
        first_name: { current: value(['Alpha']), toCheck: [] },
        location: {
          current: value(['Lyon'], { source: 'noted', notedByName: 'Inès', sourceQuote: 'je suis à Lyon' }),
          toCheck: [value(['Villeurbanne'], { source: 'inferred' })],
        },
      }),
    );
    // Only what is known: an age not known yet is left out of the line, it waits under « à découvrir ».
    expect(mixed?.querySelector('.cp-ident__line')?.textContent).toBe('Alpha·Lyon');
    expect([...(mixed?.querySelectorAll('.cp-ident__source') ?? [])].map((n) => n.textContent)).toEqual([
      'Prénom : dit par lui, il y a 3 jours',
      'Ville : noté par Inès, il y a 3 jours',
    ]);
    expect(mixed?.querySelector('.cp-field__quote')?.textContent).toBe('Ville : il a écrit je suis à Lyon');
    expect(mixed?.querySelector('.cp-field__check')?.textContent).toBe(
      'À vérifier, ville : l’agent a lu « Villeurbanne »',
    );
    expect(ident(card({}))).toBeNull();

    // The other fields: the label as an overline with its source to the right, the value under them.
    const { root } = draw(
      onCard(
        card({
          desires: { current: value(['les talons']), toCheck: [] },
          limits: { current: value(['rien de sale']), toCheck: [] },
          life_events: {
            current: value(['un déménagement'], { source: 'noted', notedByName: 'Inès' }),
            toCheck: [],
          },
        }),
      ),
    );
    const sources = ['desires', 'limits', 'life_events'].map(
      (name) =>
        root.querySelector(`[data-field="${name}"] .cp-field__top > .cp-field__source`)?.textContent ?? null,
    );
    expect(sources).toEqual([
      'Dit par lui, il y a 3 jours',
      'Dit par lui, il y a 3 jours',
      'Noté par Inès, il y a 3 jours',
    ]);
    expect(
      [...(root.querySelector('[data-field="desires"]')?.children ?? [])].map((node) => node.className),
    ).toEqual(['cp-field__top', 'cp-items']);
    expect(root.querySelector('[data-field="desires"] .cp-field__value')?.textContent).toBe('les talons');
  });

  // Design 16/11 (lot -2, then lot 0141-3): the card never states as a fact an age that is contested.
  it('says « contesté » in red on his age, in place of its source, while his age is contested', () => {
    const view = card({
      first_name: { current: value(['Alpha']), toCheck: [] },
      age: { current: value(['34']), toCheck: [] },
      location: { current: value(['Lyon']), toCheck: [] },
    });
    const contested = standingOf({ ageDisputed: { since: now.toISOString(), by: 'policy' } }, null);
    const root = draw(onCard(view, [], { standing: contested })).root;
    const ident = root.querySelector('[data-field="identity"]');
    expect(ident?.querySelector('.cp-ident__line')?.textContent).toBe('Alpha·34 anscontesté·Lyon');
    expect(ident?.querySelector('[data-field="age"] .cp-ident__contested')?.textContent).toBe('contesté');
    expect(ident?.querySelector('.cp-ident__source')).toBeNull();
    // An age not known at all still says it is contested.
    const unknownAge = draw(
      onCard(card({ first_name: { current: value(['Alpha']), toCheck: [] } }), [], { standing: contested }),
    ).root;
    expect(unknownAge.querySelector('.cp-ident__contested')?.textContent).toBe('âge contesté');
  });

  // Design 16/11, lot 0141-3: what is not known yet waits behind one muted line.
  it('names what is left to discover behind « N à découvrir », closed, the masked part left out', () => {
    const view = card({
      first_name: { current: value(['Alpha']), toCheck: [] },
      job: { current: value(['infirmier']), toCheck: [] },
    });
    const { root, actions } = draw(onCard(view));
    const fold = root.querySelector<HTMLDetailsElement>('.cp-discover');
    expect(fold?.open).toBe(false);
    const total = FAN_CARD_FIELDS.length - 2;
    expect(fold?.querySelector('.cp-discover__count')?.textContent).toBe(`${String(total)} à découvrir`);
    // After the brief, before the folds.
    const order = [...(root.querySelector('.cp-scroll')?.children ?? [])].map(
      (node) => node.getAttribute('data-group') ?? node.className,
    );
    expect(order).toEqual(['cp-brief', 'discover', 'him', 'about_her', 'intimate']);
    const titles = [...(fold?.querySelectorAll('li > .cp-overline') ?? [])].map((n) => n.textContent);
    expect(titles).toEqual(['En bref', 'Lui', 'Elle, vue par lui', 'Intime']);
    expect(fold?.querySelector('li .cp-discover__labels')?.textContent).toMatch(/^son âge, .*\.$/u);
    fold?.setAttribute('open', '');
    fold?.dispatchEvent(new Event('toggle'));
    expect(actions.toggleDiscover).toHaveBeenCalledWith(true);
    expect(
      draw(onCard(view, [], { discoverOpen: true })).root.querySelector<HTMLDetailsElement>('.cp-discover')
        ?.open,
    ).toBe(true);
    // While his age is contested, what is intimate is not even named.
    const contested = standingOf({ ageDisputed: { since: now.toISOString(), by: 'policy' } }, null);
    const masked = draw(onCard(view, [], { standing: contested })).root.querySelector('.cp-discover');
    expect(
      [...(masked?.querySelectorAll('li > .cp-overline') ?? [])].map((n) => n.textContent),
    ).not.toContain('Intime');
    expect(masked?.textContent).not.toContain('fantasmes');
  });

  // Design 16/11, lot 0141-3: at a new message of his, only the core refreshes, in a short fade.
  it('fades in the core when a new draft takes the place of another, and only then', () => {
    const { root, actions } = draw(onCard(card({}), [], { draft: ready(), assist: assistOf() }));
    expect(root.querySelector('[data-fresh]')).toBeNull();
    render(root, onCard(card({}), [], { draft: ready({ mode: 'rejecting' }), assist: assistOf() }), actions);
    expect(root.querySelector('[data-fresh]')).toBeNull();
    render(root, onCard(card({}), [], { draft: { kind: 'writing' }, assist: assistOf() }), actions);
    render(
      root,
      onCard(card({}), [], { draft: ready({ bubbles: ['et toi ?'] }), assist: assistOf() }),
      actions,
    );
    expect([...root.querySelectorAll('[data-fresh]')].map((n) => n.className)).toEqual([
      'cp-move',
      'cp-draft',
    ]);
    expect(root.querySelector('.cp-scroll [data-fresh]')).toBeNull();
  });

  // EXT-14: a value noted in the CRM while the panel is open appears with a sign.
  it('marks « nouveau » a value noted after the panel first read the card', () => {
    const { root } = draw(
      onCard(
        card({
          first_name: { current: value(['Alpha'], { observedAt: '2026-11-08T17:59:00Z' }), toCheck: [] },
          desires: { current: value(['les talons'], { observedAt: '2026-11-08T17:59:00Z' }), toCheck: [] },
          limits: { current: value(['rien de sale']), toCheck: [] },
        }),
        [],
        { newSince: '2026-11-08T17:00:00Z' },
      ),
    );
    expect(
      [...root.querySelectorAll('.cp-field__new')].map((n) =>
        n.closest('[data-field]')?.getAttribute('data-field'),
      ),
    ).toEqual(['identity', 'desires']);
    expect(
      draw(onCard(card({ limits: { current: value(['x']), toCheck: [] } }))).root.querySelector(
        '.cp-field__new',
      ),
    ).toBeNull();
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
    // The count on top says which fold holds it (V-EXT-07); each fold says it opens (V-EXT-06).
    expect(groups.map((g) => g.querySelector('.cp-group__check')?.textContent ?? null)).toEqual([
      ' · 1 à vérifier',
      null,
      null,
    ]);
    expect(groups.every((g) => g.querySelector('summary .cp-group__chevron svg') !== null)).toBe(true);
    // A fine gauge per group, filled to its share known (Design 21/11): « infirmier » is one field of « Lui ».
    const meters = groups.map((g) =>
      g.querySelector<HTMLElement>('summary .nv-meter.cp-group__meter > span'),
    );
    expect(meters.every((m) => m !== null)).toBe(true);
    expect(meters[1]?.style.getPropertyValue('--_w')).toBe('0%');
    expect(meters[0]?.style.getPropertyValue('--_w')).not.toBe('0%');
    expect(groups.map((g) => g.querySelector('.cp-group__title')?.textContent)).toEqual([
      'Lui',
      'Elle, vue par lui',
      'Intime',
    ]);
    // What is not known yet waits under « à découvrir », never in the folds (Design 16/11, lot 0141-3).
    const him = groups[0];
    expect(him?.querySelectorAll('.cp-field').length).toBe(1);
    expect(him?.textContent).not.toContain('Pas encore su');
    expect(groups[1]?.querySelector('.cp-field--unknown')?.textContent).toBe('Rien de su pour l’instant.');
    expect(root.querySelector('[data-field="job"] .cp-field__check')?.textContent).toBe(
      'À vérifier : l’agent a lu « aide-soignant »',
    );
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
    expect(root.querySelector('.cp-notice__text')?.textContent).toBe('Elle s’allume dans Créatrices › IA.');
    expect(root.querySelector('.cp-field')).toBeNull();
    // EXT-17: a chatter has no Créatrices; his manager turns it on.
    const chatter = draw({ ...screen, cardOn: false, opensCreators: false }).root;
    expect(chatter.querySelector('.cp-notice__text')?.textContent).toBe(
      'Demande à ton manager de l’allumer.',
    );
  });

  // EXT-14: the panel says which conversation it shows. Design 16/11, lot 0141-3: top to bottom, the order of his
  // questions: who, may I write, what to do, the text; the card under it scrolls.
  it('stacks the band, the core and the card, in the order of the chatter’s questions', () => {
    const { root } = draw(
      onCard(card({}), [], { fanName: '<i>marc_lyon</i>', draft: ready(), assist: assistOf() }),
    );
    expect([...root.children].map((node) => node.className)).toEqual([
      'cp-band',
      'cp-move',
      'cp-draft',
      'cp-scroll',
    ]);
    expect(root.querySelector('.cp-band__fan')?.textContent).toBe('<i>marc_lyon</i>');
    expect(root.querySelector('.cp-band i')).toBeNull();
    // The button is in the core, above everything that scrolls: a long draft pushes the sale line, never the button.
    const place = root.querySelector('[data-gesture="place"]');
    const scroll = root.querySelector('.cp-scroll');
    if (place === null || scroll === null) throw new Error('missing');
    expect(place.compareDocumentPosition(scroll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scroll.contains(place)).toBe(false);
    expect(scroll.firstElementChild?.classList.contains('cp-sale')).toBe(true);
  });

  it('says where things stand as badges: red forbids, amber holds back, then his desire', () => {
    const labels = (screen: PanelScreen): (string | null)[] => badgeLabels(draw(screen).root);
    const { root } = draw(
      onCard(card({}), [], {
        standing: standingOf(
          { salesFrozen: { reason: 'distress', since: now.toISOString() }, fragile: true },
          'playful',
        ),
      }),
    );
    expect([...root.querySelectorAll<HTMLElement>('.cp-badge')].map((n) => n.dataset['tone'])).toEqual([
      'red',
      'amber',
      'neutral',
    ]);
    // Each badge has its icon, and is said in words to a screen reader; no emoji in the interface (V-EXT).
    expect(badgeLabels(root)).toEqual(['Ventes gelées', 'Fan fragile', 'Désir joueur']);
    expect([...root.querySelectorAll('.cp-badge')].every((n) => n.querySelector('svg') !== null)).toBe(true);
    expect(root.querySelector('.cp-badge[data-kind="desire"]')?.textContent).toBe('joueur');
    // No badge when there is nothing to say (Design 16/11, lot 0141-3).
    expect(labels(onCard(card({}), [], { standing: standingOf({}, null) }))).toEqual([]);
    expect(labels(onCard(card({}), [], { standing: standingOf('unread', null) }))).toEqual([
      'Limites non lues',
    ]);
    expect(
      labels(onCard(card({}), [], { standing: standingOf({ spendingLimitMinor: 15_000 }, null) })),
    ).toEqual(['Plafond 150\u00a0€']);
    // While « où on en est » is read the first time, the band waits, quietly.
    expect(
      draw(onCard(card({}), [], { standing: null })).root.querySelector('.cp-badges [aria-busy]'),
    ).not.toBeNull();
  });

  it('shows no draft when her drafts are off or none waits, and « L’agent écrit… » while it writes', () => {
    expect(draw(onCard(card({}))).root.querySelector('.cp-draft')).toBeNull();
    const writing = draw(onCard(card({}), [], { draft: { kind: 'writing' } })).root;
    expect(writing.querySelector('.cp-draft')?.textContent).toBe('L’agent écrit…');
  });

  it('puts the draft in the core, above the card, with its three gestures and their keys', () => {
    const { root, actions } = draw(onCard(card({}), [], { draft: ready() }));
    // A server without the agent's view: the band, the draft, then the card that scrolls.
    expect([...root.children].map((node) => node.className)).toEqual(['cp-band', 'cp-draft', 'cp-scroll']);
    expect([...root.querySelectorAll('.cp-bubble')].map((n) => n.textContent)).toEqual([
      'coucou toi 😘',
      'tu rentres quand de ta garde ?',
    ]);
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.cp-draft__actions button')];
    // Charles's word (recette visuelle V-EXT-02): the button says what it does, one verb for the gesture, « copier ».
    expect(buttons.map((b) => b.textContent)).toEqual(['Copier pour Reveal A', 'Retoucher E', 'Refuser R']);
    expect(buttons[0]?.classList.contains('cp-send')).toBe(true);
    // « Copier pour Reveal » is the one filled button, the two others light (Design 16/11, lot 0141-3).
    expect(buttons.slice(1).every((b) => b.classList.contains('nv-btn--plain'))).toBe(true);
    expect(root.querySelector('.cp-draft__stop')).toBeNull();
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
    // The gesture and « Annuler » share one line: no half-width orphan (EXT-21).
    const row = root.querySelector('.cp-draft__actions');
    expect(row?.classList.contains('cp-draft__actions--pair')).toBe(true);
    // « Annuler » first and the gesture on the right, as in the CRM's confirmations (V-EXT-14).
    expect([...(row?.children ?? [])].map((b) => b.textContent)).toEqual(['Annuler', 'Copier pour Reveal']);
    expect(root.querySelector('.cp-draft__hint')?.textContent).toBe(
      'Une bulle par ligne. Ctrl+Entrée copie le texte.',
    );
    root.querySelector<HTMLButtonElement>('[data-gesture="place-edited"]')?.click();
    expect(actions.place).toHaveBeenCalledWith(true);
  });

  // Recette du 16/11, EXT-01: the card read again every 5 s drew the panel anew, and the field lost his keys.
  it('keeps the field he retouches in place, with its focus, text and caret, when the card is drawn again', () => {
    const editing = ready({ mode: 'editing', text: 'coucou toi 😘' });
    const { root, actions } = draw(onCard(card({}), [], { draft: editing }));
    document.body.append(root);
    const area = root.querySelector<HTMLTextAreaElement>('textarea');
    if (area === null) throw new Error('field');
    area.focus();
    area.value = 'coucou toi 😘 tu fais quoi';
    area.setSelectionRange(5, 5);
    // His text in the state (as main.ts keeps it), and a card read again with a new value.
    render(
      root,
      onCard(card({ first_name: { current: value(['Alpha']), toCheck: [] } }), [], {
        draft: ready({ mode: 'editing', text: 'coucou toi 😘 tu fais quoi' }),
      }),
      actions,
    );
    expect(root.querySelector('textarea')).toBe(area);
    expect(document.activeElement).toBe(area);
    expect(area.value).toBe('coucou toi 😘 tu fais quoi');
    expect(area.selectionStart).toBe(5);
    expect(root.querySelector('.cp-scroll')?.textContent).toContain('Alpha');
    // Kept in place, it is not wired twice.
    root.querySelector<HTMLButtonElement>('[data-gesture="place-edited"]')?.click();
    expect(actions.place).toHaveBeenCalledOnce();
    // Another state of the draft is drawn anew.
    render(root, onCard(card({}), [], { draft: ready() }), actions);
    expect(root.querySelector('textarea')).toBeNull();
    // Only his retouched text is left out of the key: a draft rewritten in the same state shows its new bubbles
    // (Bilan's question on #783).
    render(root, onCard(card({}), [], { draft: ready({ bubbles: ['un autre texte'] }) }), actions);
    expect([...root.querySelectorAll('.cp-bubble')].map((n) => n.textContent)).toEqual(['un autre texte']);
    root.remove();
  });

  it('refuses with a reason of the closed list and an optional note, the button shut until a reason', () => {
    const shut = draw(onCard(card({}), [], { draft: ready({ mode: 'rejecting' }) })).root;
    expect(shut.querySelector<HTMLButtonElement>('[data-gesture="send-reject"]')?.disabled).toBe(true);
    expect(
      [...(shut.querySelector('.cp-draft__actions--pair')?.children ?? [])].map((b) => b.textContent),
    ).toEqual(['Annuler', 'Refuser']);
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
        draft: ready({
          done: { outcome: 'placed', bubbles: ['coucou toi 😘'], copied: 1, copyFailed: false, sent: 'sent' },
        }),
      }),
    ).root;
    expect(placed.querySelector('.cp-draft__next')?.textContent).toBe(
      'Texte copié : colle-le dans Reveal (Ctrl+V), relis, et envoie.',
    );
    expect(placed.querySelector('.cp-draft__actions')).toBeNull();
    expect(placed.querySelector('.cp-draft__warn')).toBeNull();
    const unlinked = draw(
      onCard(card({}), [], {
        draft: ready({
          done: {
            outcome: 'rejected',
            bubbles: ['coucou toi 😘'],
            copied: 0,
            copyFailed: false,
            sent: 'unlinked',
          },
        }),
      }),
    ).root;
    // A refused draft that stays on screen is put out: it never looks like one to place.
    expect(unlinked.querySelector('.cp-bubbles')?.getAttribute('data-off')).toBe('true');
    expect(placed.querySelector('.cp-bubbles')?.getAttribute('data-off')).toBeNull();
    expect(unlinked.querySelector('.cp-draft__warn')?.textContent).toBe(
      'Ce geste n’a pas compté : relie l’extension (clique sur l’icône Impera, puis «\u00a0Relier\u00a0»).',
    );
  });

  // Agent, relecture du 21/11 (ADR 0086 § 5): a paid step copied by hand leaves without its media.
  it('tells him to send the paid media too when the copied draft is the sale, in amber', () => {
    const copied = ready({
      done: { outcome: 'placed', bubbles: ['coucou toi 😘'], copied: 1, copyFailed: false, sent: 'sent' },
    });
    const sale = draw(onCard(card({}), [], { draft: copied, assist: assistOf() })).root;
    expect(sale.querySelector('.cp-draft__warn[data-media]')?.textContent).toBe(
      'Envoie aussi le média à 15\u00a0€ depuis Reveal : le texte seul ne le vend pas.',
    );
    const again = draw(onCard(card({}), [], { draft: ready({ placed: true }), assist: assistOf() })).root;
    expect(again.querySelector('[data-media]')).not.toBeNull();
    const talk = assistOf({ nextMove: { kind: 'reply', label: 'Répondre', priceMinor: null, block: null } });
    const plain = draw(onCard(card({}), [], { draft: copied, assist: talk })).root;
    expect(plain.querySelector('[data-media]')).toBeNull();
  });

  // EXT-13: Reveal sends one bubble per message; they are copied one at a time, the gesture counted once.
  it('copies several bubbles one at a time, the next under its own button and `a`', () => {
    const done = (copied: number): DraftPart =>
      ready({
        done: {
          outcome: 'placed',
          bubbles: ['coucou toi 😘', 'tu fais quoi ?', 'je pense à toi'],
          copied,
          copyFailed: false,
          sent: 'sent',
        },
      });
    const { root, actions } = draw(onCard(card({}), [], { draft: done(1) }));
    expect(root.querySelector('.cp-draft__next')?.textContent).toBe(
      'Bulle 1 sur 3 copiée : colle-la dans Reveal (Ctrl+V), envoie, puis copie la suivante.',
    );
    expect([...root.querySelectorAll('.cp-bubble')].map((n) => n.getAttribute('data-copied'))).toEqual([
      'true',
      null,
      null,
    ]);
    // The copied bubble says so in words, not only by its edge (Design, lot -1).
    expect(root.querySelector('.cp-bubble[data-copied] .cp-bubble__done')?.textContent).toBe('copiée');
    expect(root.querySelector('.cp-bubble[data-copied] .cp-bubble__done svg')).not.toBeNull();
    const next = root.querySelector<HTMLButtonElement>('[data-gesture="copy-next"]');
    expect(next?.textContent).toBe('Copier la bulle 2 A');
    next?.click();
    expect(actions.copyNext).toHaveBeenCalledOnce();
    const last = draw(onCard(card({}), [], { draft: done(3) })).root;
    expect(last.querySelector('.cp-draft__next')?.textContent).toBe(
      'Bulle 3 sur 3 copiée : colle-la dans Reveal (Ctrl+V) et envoie. C’était la dernière.',
    );
    expect(last.querySelector('[data-gesture="copy-next"]')).toBeNull();
  });

  // EXT-05: « Ne plus lui écrire » forbids any word to him; the panel offers nothing to copy, only the refusal.
  it('offers no text to copy for a fan he must no longer write to, and says why in red', () => {
    const stop = standingOf({ doNotContact: true }, null);
    const { root } = draw(onCard(card({}), [], { standing: stop, draft: ready() }));
    expect(root.querySelector('[data-gesture="place"]')).toBeNull();
    expect(root.querySelector('[data-gesture="edit"]')).toBeNull();
    expect(root.querySelector('[data-gesture="reject"]')).not.toBeNull();
    expect(root.querySelector('.cp-draft__stop')?.textContent).toBe(
      'Ne plus lui écrire : rien ne part vers lui. Refuse ce brouillon.',
    );
    // Its bubbles are put out, and « Refuser », the one action, is on the secondary plate (Design, lot -1).
    expect(root.querySelector('.cp-bubbles')?.getAttribute('data-off')).toBe('true');
    expect(root.querySelector('[data-gesture="reject"]')?.classList.contains('nv-btn--soft')).toBe(true);
    expect(
      draw(onCard(card({}), [], { draft: ready() })).root.querySelector('.cp-bubbles[data-off]'),
    ).toBeNull();
    const editing = draw(
      onCard(card({}), [], { standing: stop, draft: ready({ mode: 'editing', text: 'x' }) }),
    ).root;
    expect(editing.querySelector('[data-gesture="place-edited"]')).toBeNull();
    // A stop that forbids an offer, not a word, leaves the gestures.
    const frozen = standingOf({ salesFrozen: { reason: 'distress', since: now.toISOString() } }, null);
    expect(
      draw(onCard(card({}), [], { standing: frozen, draft: ready() })).root.querySelector(
        '[data-gesture="place"]',
      ),
    ).not.toBeNull();
  });

  // Bilan's review: limits that could not be read may hide « Ne plus lui écrire »; closed until they are read, in amber.
  it('offers no text to copy while his limits are not read, and says so in amber', () => {
    const unread = standingOf('unread', null);
    const { root } = draw(onCard(card({}), [], { standing: unread, draft: ready() }));
    expect(root.querySelector('[data-gesture="place"]')).toBeNull();
    expect(root.querySelector('[data-gesture="edit"]')).toBeNull();
    expect(root.querySelector('[data-gesture="reject"]')).not.toBeNull();
    expect(root.querySelector('.cp-draft__stop')).toBeNull();
    expect(root.querySelector('.cp-draft__warn')?.textContent).toBe(
      'Impossible de lire ses limites pour l’instant\u00a0: rien à copier tant que ce n’est pas rétabli. Tu peux refuser ce brouillon.',
    );
    const editing = draw(
      onCard(card({}), [], { standing: unread, draft: ready({ mode: 'editing', text: 'x' }) }),
    ).root;
    expect(editing.querySelector('[data-gesture="place-edited"]')).toBeNull();
  });

  // EXT-20: the field is sized on the text's length, not only its lines.
  it('gives the retouched text room for a long bubble', () => {
    const rows = (text: string): string | null | undefined =>
      draw(onCard(card({}), [], { draft: ready({ mode: 'editing', text }) }))
        .root.querySelector('textarea')
        ?.getAttribute('rows');
    expect(rows('coucou')).toBe('3');
    expect(rows('a'.repeat(32 * 5))).toBe('5');
    expect(rows('a'.repeat(1000))).toBe('8');
  });

  // EXT-16: a group opened from the keyboard keeps the keyboard when the card is drawn again.
  it('gives the focus back to the control that had it when the card is drawn again', () => {
    const { root, actions } = draw(onCard(card({}), ['him']));
    document.body.append(root);
    root.querySelector<HTMLElement>('[data-group="him"] > summary')?.focus();
    render(root, onCard(card({ first_name: { current: value(['Alpha']), toCheck: [] } }), ['him']), actions);
    expect(document.activeElement).toBe(root.querySelector('[data-group="him"] > summary'));
    render(root, onCard(card({}), [], { draft: ready({ mode: 'rejecting' }) }), actions);
    root.querySelector<HTMLElement>('[data-reason="too_long"]')?.focus();
    render(root, onCard(card({}), [], { draft: ready({ mode: 'rejecting', reason: 'too_long' }) }), actions);
    expect(document.activeElement).toBe(root.querySelector('[data-reason="too_long"]'));
    root.remove();
  });
  // V-EXT-03: a red stop said again next to the draft, and the send no longer the ink button.
  it('says a red stop again above the bubbles and quiets the send, the rule staying the server’s', () => {
    const { root, actions } = draw(
      onCard(card({}), [], {
        draft: ready(),
        standing: standingOf({ salesFrozen: { reason: 'distress', since: now.toISOString() } }, null),
      }),
    );
    const section = root.querySelector('.cp-draft');
    const stop = section?.querySelector('.cp-draft__stop');
    expect(stop?.textContent).toBe('Ventes gelées : relis-le avant de l’envoyer.');
    expect(stop?.nextElementSibling?.classList.contains('cp-bubbles')).toBe(true);
    const place = root.querySelector<HTMLButtonElement>('[data-gesture="place"]');
    expect(place?.classList.contains('cp-send')).toBe(false);
    expect(place?.classList.contains('nv-btn--soft')).toBe(true);
    // Outlined, in full ink: quiet, never read as off (Design, lot 0141-3).
    expect(place?.classList.contains('cp-place--quiet')).toBe(true);
    expect(place?.disabled).toBe(false);
    place?.click();
    expect(actions.place).toHaveBeenCalledWith(false);
  });

  // V-EXT-20: the question is written, and the reasons are one stop of the keyboard, walked with the arrows.
  it('asks why it is refused and walks the reasons with the arrows', () => {
    const { root, actions } = draw(
      onCard(card({}), [], { draft: ready({ mode: 'rejecting', reason: 'too_long' }) }),
    );
    const group = root.querySelector('[role="radiogroup"]');
    const question = root.querySelector(`#${group?.getAttribute('aria-labelledby') ?? 'none'}`);
    expect(question?.textContent).toBe('Pourquoi tu le refuses ?');
    const chips = [...root.querySelectorAll<HTMLElement>('[data-reason]')];
    expect(chips.filter((chip) => chip.tabIndex === 0).map((chip) => chip.dataset['reason'])).toEqual([
      'too_long',
    ]);
    const picked = chips.findIndex((chip) => chip.dataset['reason'] === 'too_long');
    chips[picked]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(actions.pickReason).toHaveBeenLastCalledWith(
      chips[(picked + 1) % chips.length]?.dataset['reason'],
    );
    chips[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(actions.pickReason).toHaveBeenLastCalledWith(chips.at(-1)?.dataset['reason']);
    // With no reason yet, the first one takes the keyboard's stop.
    const none = draw(onCard(card({}), [], { draft: ready({ mode: 'rejecting' }) })).root;
    expect([...none.querySelectorAll<HTMLElement>('[data-reason]')].map((chip) => chip.tabIndex)[0]).toBe(0);
  });

  // V-EXT: no native tooltip anywhere, and each notice carries its picture.
  it('draws no native tooltip and gives each notice its icon', () => {
    const { root } = draw(onCard(card({ first_name: { current: value(['Marc']), toCheck: [] } })));
    expect(root.querySelector('[title]')).toBeNull();
    for (const kind of ['signed_out', 'no_conversation', 'unknown', 'off_shift', 'down'] as const)
      expect(draw({ kind }).root.querySelector('.cp-notice__icon svg')).not.toBeNull();
  });
});

describe('what to do now, and where the sale stands (ADR 0141, lot a)', () => {
  const base = assistOf;
  const with_ = (
    assist: CopilotAssist | null,
    patch: Parameters<typeof onCard>[2] = {},
  ): ReturnType<typeof draw>['root'] =>
    draw(onCard(card({}), [], { draft: ready(), standing: standingOf({}, 'hot'), assist, ...patch })).root;

  it('draws the panel as before for a server that does not send it yet', () => {
    const before = draw(onCard(card({}), [], { draft: ready(), standing: standingOf({}, 'hot') })).root;
    expect(before.querySelector('.cp-move')).toBeNull();
    expect(before.querySelector('.cp-sale')).toBeNull();
    expect(badgeLabels(before)).toEqual(['Désir chaud']);
    expect([...before.children].map((node) => node.className)).toEqual(['cp-band', 'cp-draft', 'cp-scroll']);
  });

  it('says the gesture in bold and why in small, right above the draft, in a neutral tone', () => {
    const root = with_(base());
    expect([...root.children].map((node) => node.className)).toEqual([
      'cp-band',
      'cp-move',
      'cp-draft',
      'cp-scroll',
    ]);
    const move = root.querySelector<HTMLElement>('.cp-move');
    expect(move?.dataset['tone']).toBe('neutral');
    expect(move?.querySelector('.cp-move__what')?.textContent).toBe('Proposer «\u00a0Étape 3\u00a0» à 15 €');
    // Why a step is proposed, from what is known (Design 16/11); the note on the text goes with the draft.
    expect(move?.querySelector('.cp-move__why')?.textContent).toBe('Désir chaud, étape 2 sur 4');
    expect(root.querySelector('.cp-draft__about')?.textContent).toBe('Réécrit une fois par une garde');
    expect(move?.textContent).not.toContain('Réécrit');
    // « Copier pour Reveal » stays the one strong action, in the brand's neon on a sale; lot b's buttons are not drawn.
    expect(root.querySelectorAll('[data-gesture="place"]')).toHaveLength(1);
    expect(root.querySelector('[data-gesture="place"]')?.className).toContain('nv-btn--neon');
    expect(root.querySelector('[data-assist]')).toBeNull();
  });

  it.each([
    ['reply', 'Répondre'],
    ['answer_objection', 'Répondre à son objection'],
    ['custom_order_accept', 'Commande perso : accepter'],
    ['custom_order_decline', 'Commande perso : refuser'],
    ['custom_order_wait', 'Commande perso : attendre'],
    ['wait', 'Attendre avant de répondre'],
    ['hand_over', 'Rendre la main à un humain'],
  ] as const)('draws the gesture %s, and still without a draft waiting', (kind, label) => {
    const assist = base({ nextMove: { kind, label, priceMinor: null, block: null }, reasons: [] });
    for (const draft of [ready(), { kind: 'hidden' } as const]) {
      const root = with_(assist, { draft });
      expect(root.querySelector<HTMLElement>('.cp-move')?.dataset['move']).toBe(kind);
      expect(root.querySelector('.cp-move__what')?.textContent).toBe(label);
      expect(root.querySelector('.cp-move__why')).toBeNull();
    }
  });

  it('says « ne rien vendre » in amber with the block, in red for « Ne plus lui écrire » and « Ventes gelées »', () => {
    const low = with_(
      base({ nextMove: { kind: 'no_sale', label: 'Ne rien vendre', priceMinor: null, block: 'low_desire' } }),
    );
    expect(low.querySelector<HTMLElement>('.cp-move')?.dataset['tone']).toBe('amber');
    expect(low.querySelector('.cp-move__why')?.textContent).toBe('Désir encore trop bas');
    const frozen = with_(
      base({
        nextMove: { kind: 'no_sale', label: 'Ne rien vendre', priceMinor: null, block: 'sales_frozen' },
      }),
    );
    expect(frozen.querySelector<HTMLElement>('.cp-move')?.dataset['tone']).toBe('red');
    const blocked = with_(
      base({
        nextMove: { kind: 'no_sale', label: 'Ne rien vendre', priceMinor: null, block: 'do_not_contact' },
      }),
    );
    expect(blocked.querySelector<HTMLElement>('.cp-move')?.dataset['tone']).toBe('red');
  });

  it.each([
    ['age_doubt', 'red', 'Âge contesté\u00a0: un humain doit le lever avant tout.'],
    ['care', 'amber', 'Fan fragile\u00a0: on ne lui vend rien. Relis le brouillon avant de l’envoyer.'],
    [
      'care_exit',
      'amber',
      'Fan fragile qui va mieux\u00a0: ni vente ni rien de coquin. Relis le brouillon avant de l’envoyer.',
    ],
    [
      'sales_frozen',
      'red',
      'Ventes gelées\u00a0: on ne lui vend rien. Relis le brouillon avant de l’envoyer.',
    ],
  ] as const)('replaces what to do with one sentence under the cut %s, the sale gone', (cut, tone, text) => {
    const root = with_(
      base({ cuts: [cut], sale: null, buttons: [], signals: { desireTrend: 'up', followUpDue: true } }),
    );
    const move = root.querySelector<HTMLElement>('.cp-move');
    expect(move?.dataset['cut']).toBe(cut);
    expect(move?.dataset['tone']).toBe(tone);
    expect(move?.textContent).toBe(text);
    expect(root.querySelector('.cp-move__what')).toBeNull();
    expect(root.querySelector('.cp-sale')).toBeNull();
    // No signal pushes to write or to sell under a cut; a contested age silences his desire too (Design 16/11).
    expect(badgeLabels(root)).toEqual(cut === 'age_doubt' ? [] : ['Désir chaud']);
  });

  // Design 16/11: each cut said once. Under the sentence, the draft adds no line of its own.
  it('says a cut once: the sentence above the draft, and no line under « Brouillon de l’agent »', () => {
    for (const flags of [
      { salesFrozen: { reason: 'distress', since: now.toISOString() }, fragile: true },
      { salesFrozen: { reason: 'distress', since: now.toISOString() } },
    ] as const) {
      const root = with_(base({ cuts: ['care', 'sales_frozen'], sale: null, buttons: [] }), {
        standing: standingOf(flags, 'hot'),
      });
      expect(root.querySelectorAll('.cp-move')).toHaveLength(1);
      expect(root.querySelector('.cp-draft__stop')).toBeNull();
      expect(root.querySelector('.cp-draft__warn')).toBeNull();
      // The copy is still not the ink button: the sentence above asks to reread.
      expect(root.querySelector('.cp-place')?.classList.contains('cp-send')).toBe(false);
      expect(root.querySelector('.cp-place')?.classList.contains('cp-place--quiet')).toBe(true);
    }
    // Without a cut, a stop still says « relis-le » with the draft, as before.
    const stopped = with_(base(), {
      standing: standingOf({ salesFrozen: { reason: 'distress', since: now.toISOString() } }, 'hot'),
    });
    expect(stopped.querySelector('.cp-draft__stop')?.textContent).toContain('Ventes gelées');
  });

  // Agent 16/11: while his age is contested, his fantasies and what is intimate are masked, by the panel itself too.
  it('masks « Ses fantasmes » and « Intime » while his age is contested, whatever the server sent', () => {
    const intimate = card({
      desires: {
        current: value(['qu’elle prenne les devants']),
        toCheck: [value(['les talons'], { source: 'inferred' })],
      },
      lead: { current: value(['she_leads']), toCheck: [] },
    });
    const masked = (patch: Parameters<typeof onCard>[2]): ReturnType<typeof draw>['root'] =>
      draw(onCard(intimate, [], { draft: { kind: 'hidden' }, assist: base(), ...patch })).root;
    for (const root of [
      masked({ standing: standingOf({}, 'hot'), assist: base({ cuts: ['age_doubt'], sale: null }) }),
      masked({ standing: standingOf({ ageDisputed: { since: now.toISOString(), by: 'policy' } }, 'hot') }),
    ]) {
      const desires = root.querySelector<HTMLElement>('[data-field="desires"]');
      expect(desires?.dataset['masked']).toBe('true');
      expect(desires?.textContent).toBe('Ses fantasmesMasqué tant que son âge est contesté.');
      const group = root.querySelector<HTMLElement>('[data-group="intimate"]');
      expect(group?.tagName).toBe('DIV');
      expect(group?.textContent).toBe('IntimeMasqué tant que son âge est contesté.');
      expect(root.textContent).not.toContain('prenne les devants');
      expect(root.textContent).not.toContain('talons');
      // Its checks are not counted: the count would send him to what is masked.
      expect(root.querySelector('.cp-head__check')).toBeNull();
      expect(root.querySelector('.cp-field__masked')?.getAttribute('style')).toBeNull();
      // What he does not want stays read: it protects him.
      expect(root.querySelector<HTMLElement>('[data-field="limits"]')?.dataset['masked']).toBeUndefined();
    }
    const open = masked({ standing: standingOf({}, 'hot') });
    expect(open.querySelector('[data-field="desires"]')?.textContent).toContain('prenne les devants');
    expect(open.querySelector('[data-group="intimate"]')?.tagName).toBe('DETAILS');
  });

  it('cuts the sale on its own when his limits are not read or forbid a word, said once with the draft', () => {
    // A server that still offers a step: the panel's own reading of his limits wins.
    const unread = with_(base(), { standing: standingOf('unread', null) });
    expect(unread.querySelector('.cp-move')).toBeNull();
    expect(unread.querySelector('.cp-sale')).toBeNull();
    expect(unread.querySelector('.cp-draft__warn')).not.toBeNull();
    const stop = with_(base(), { standing: standingOf({ doNotContact: true }, null) });
    expect(stop.querySelector('.cp-move')).toBeNull();
    expect(stop.querySelector('.cp-draft__stop')?.textContent).toContain('Ne plus lui écrire');
    // With no draft to say it, the cut stands alone, in red.
    const alone = with_(base(), {
      standing: standingOf({ doNotContact: true }, null),
      draft: { kind: 'hidden' },
    });
    expect(alone.querySelector<HTMLElement>('.cp-move')?.dataset['cut']).toBe('do_not_contact');
    expect(alone.querySelector<HTMLElement>('.cp-move')?.dataset['tone']).toBe('red');
    const unreadAlone = with_(base(), { standing: standingOf('unread', null), draft: { kind: 'hidden' } });
    expect(unreadAlone.querySelector<HTMLElement>('.cp-move')?.dataset['cut']).toBe('limits_unread');
    // Nothing of the sale while « où on en est » is read the first time.
    const reading = draw(onCard(card({}), [], { draft: ready(), standing: null, assist: base() })).root;
    expect(reading.querySelector('.cp-move')).toBeNull();
    expect(reading.querySelector('.cp-sale')).toBeNull();
  });

  it('says the sale in one line under the core, with its step dots, the detail behind a click', () => {
    const { root, actions } = draw(
      onCard(card({}), [], { draft: ready(), standing: standingOf({}, 'hot'), assist: base() }),
    );
    const fold = root.querySelector<HTMLDetailsElement>('.cp-sale');
    expect(fold?.open).toBe(false);
    expect(root.querySelector('.cp-scroll')?.firstElementChild).toBe(fold);
    expect(fold?.querySelector('.cp-sale__line')?.textContent).toBe(
      'Soirée d’essai 2/4 · ensuite «\u00a0Étape 3\u00a0» 15\u00a0€',
    );
    // One dot per step, read by the eye; the line says it in words to a screen reader.
    expect(
      [...(fold?.querySelectorAll<HTMLElement>('.cp-step') ?? [])].map((n) => n.dataset['step']),
    ).toEqual(['done', 'now', 'next', 'next']);
    expect(fold?.querySelector('.cp-steps')?.getAttribute('aria-hidden')).toBe('true');
    expect(fold?.querySelector('summary')?.getAttribute('aria-label')).toBe(
      'Où en est la vente : Soirée d’essai 2/4 · ensuite «\u00a0Étape 3\u00a0» 15\u00a0€',
    );
    expect([...(fold?.querySelectorAll('.cp-field__label') ?? [])].map((n) => n.textContent)).toEqual([
      'Étapes refusées',
      'Objections déjà servies',
    ]);
    // One pill per refused step and per objection served (Design 21/11).
    expect(
      [...(fold?.querySelectorAll('.cp-pills') ?? [])].map((list) =>
        [...list.querySelectorAll('.nv-tag')].map((n) => n.textContent),
      ),
    ).toEqual([['Étape 2 bis'], ['C’est trop cher']]);
    fold?.setAttribute('open', '');
    fold?.dispatchEvent(new Event('toggle'));
    expect(actions.toggleSale).toHaveBeenCalledWith(true);
    const open = with_(base(), { saleOpen: true });
    expect(open.querySelector<HTMLDetailsElement>('.cp-sale')?.open).toBe(true);
    // Under « Ne rien vendre », the line drops the next step and its price; the detail says them (Design, lot 0141-3).
    const noSale = with_(
      base({ nextMove: { kind: 'no_sale', label: 'Ne rien vendre', priceMinor: null, block: 'low_desire' } }),
      { saleOpen: true },
    );
    expect(noSale.querySelector('.cp-sale__line')?.textContent).toBe('Soirée d’essai 2/4');
    expect(noSale.querySelectorAll('.cp-sale .cp-step')).toHaveLength(4);
    expect(noSale.querySelector('.cp-sale .cp-field__label')?.textContent).toBe('Prochaine étape');
    expect(noSale.querySelector('.cp-sale .cp-field__value')?.textContent).toBe(
      '«\u00a0Étape 3\u00a0» 15\u00a0€',
    );
  });

  it('adds the signals to the band, three badges at most, then « +N »', () => {
    const pending = base();
    if (pending.sale === null) throw new Error('sale');
    const lively = base({
      signals: { desireTrend: 'up', followUpDue: true },
      sale: { ...pending.sale, offerPending: true },
    });
    const calm = with_(lively);
    expect(badgeLabels(calm)).toEqual(['Désir chaud, en hausse', 'Relance due', 'Offre sans réponse']);
    // His desire's direction is an arrow by the flame, never a sentence.
    expect(calm.querySelectorAll('.cp-badge[data-kind="desire"] svg')).toHaveLength(2);
    expect(calm.querySelector('.cp-badges__more')).toBeNull();
    const { root, actions } = draw(
      onCard(card({}), [], {
        draft: ready(),
        standing: standingOf({ fragile: true }, 'hot'),
        assist: lively,
      }),
    );
    expect(badgeLabels(root)).toEqual(['Fan fragile', 'Désir chaud, en hausse', 'Relance due']);
    const more = root.querySelector<HTMLButtonElement>('.cp-badges__more');
    expect(more?.textContent).toBe('+1');
    expect(more?.getAttribute('aria-label')).toBe('Voir 1 de plus');
    more?.click();
    expect(actions.showSignals).toHaveBeenCalledOnce();
    const opened = with_(lively, { standing: standingOf({ fragile: true }, 'hot'), signalsOpen: true });
    expect(badgeLabels(opened)).toEqual([
      'Fan fragile',
      'Désir chaud, en hausse',
      'Relance due',
      'Offre sans réponse',
    ]);
    // What forbids or holds back is never folded, even past three.
    const many = with_(lively, {
      standing: standingOf({ fragile: true, noExplicit: true, spendingLimitMinor: 5_000 }, 'hot'),
    });
    expect(many.querySelectorAll('.cp-badge[data-tone="amber"]')).toHaveLength(3);
    expect(many.querySelector('.cp-badges__more')?.textContent).toBe('+2');
    expect(many.querySelector('[title]')).toBeNull();
  });
});

describe('colour and the moment to sell (ADR 0141 § 4 bis; Design 16/11, lot 0141-5)', () => {
  const moment = (
    verdict: 'good' | 'soon' | 'not_yet',
    met: [boolean, boolean, boolean],
  ): NonNullable<CopilotAssist['saleMoment']> => ({
    verdict,
    conditions: [
      { code: 'desire_below_threshold', met: met[0] },
      { code: 'not_sexualizing', met: met[1] },
      { code: 'availability_unconfirmed', met: met[2] },
    ],
  });
  const drawn = (assist: CopilotAssist, standing: Standing | null = standingOf({}, 'hot')): HTMLElement =>
    draw(onCard(card({}), [], { draft: ready(), standing, assist })).root;
  const place = (root: ParentNode): string => root.querySelector('[data-gesture="place"]')?.className ?? '';

  it('says the moment in place of « pourquoi »: its notches, its verdict, what is missing', () => {
    const root = drawn(
      assistOf({
        nextMove: { kind: 'no_sale', label: 'Ne rien vendre', priceMinor: null, block: 'low_desire' },
        saleMoment: moment('not_yet', [false, true, true]),
      }),
    );
    expect(root.querySelector('.cp-move__why')).toBeNull();
    const line = root.querySelector<HTMLElement>('.cp-moment');
    expect(line?.dataset['verdict']).toBe('not_yet');
    expect(line?.textContent).toBe('Pas encore · il manque son désir');
    // Filled from the left: the met notches first, the missing one on the right.
    expect(
      [...(line?.querySelectorAll<HTMLElement>('.cp-notch') ?? [])].map((n) => n.dataset['met']),
    ).toEqual(['true', 'true', 'false']);
    // Not a sale: the button keeps its ink.
    expect(place(root)).toContain('cp-send');
    expect(place(root)).not.toContain('nv-btn--neon');
  });

  it('counts the other missing conditions in the band plate, after the first one named', () => {
    const root = drawn(assistOf({ saleMoment: moment('not_yet', [false, false, true]) }));
    const line = root.querySelector<HTMLElement>('.cp-moment');
    const plate = line?.querySelector<HTMLElement>('.cp-badges__more');
    expect(plate?.textContent).toBe('+1');
    expect(plate?.tagName).toBe('SPAN');
    expect(plate?.getAttribute('aria-label')).toBe('et 1 autre condition');
    expect(line?.querySelector('.cp-moment__text')?.textContent).not.toContain('…');
    // The name shown is the first missing one of the fold, in the same order.
    expect(line?.querySelector('.cp-moment__text')?.textContent).toBe('Pas encore · il manque son désir');
    const missing = [...root.querySelectorAll<HTMLElement>('.cp-condition[data-met="false"]')];
    expect(missing.map((row) => row.textContent)).toEqual([
      'Son désir est encore basmanque',
      'Il n’a pas encore pris le ton coquinmanque',
    ]);
    const one = drawn(assistOf({ saleMoment: moment('soon', [true, false, true]) }));
    expect(one.querySelector('.cp-moment .cp-badges__more')).toBeNull();
  });

  it.each([
    ['good', [true, true, true], 'Bon moment'],
    ['soon', [true, false, true], 'Bientôt · il manque le ton coquin'],
  ] as const)("words the verdict %s from the panel's closed list", (verdict, met, text) => {
    const root = drawn(assistOf({ saleMoment: moment(verdict, [...met]) }));
    expect(root.querySelector('.cp-moment__text')?.textContent).toBe(text);
  });

  it('says a block no condition says, so « Ne rien vendre » never goes without its reason', () => {
    const root = drawn(
      assistOf({
        nextMove: { kind: 'no_sale', label: 'Ne rien vendre', priceMinor: null, block: 'no_budget' },
        saleMoment: moment('not_yet', [true, true, true]),
      }),
    );
    expect(root.querySelector('.cp-moment__text')?.textContent).toBe(
      'Pas encore · Il a dit ne pas avoir d’argent',
    );
  });

  it('keeps « pourquoi » for a server that does not say the moment', () => {
    const root = drawn(assistOf());
    expect(root.querySelector('.cp-moment')).toBeNull();
    expect(root.querySelector('.cp-move__why')?.textContent).toBe('Désir chaud, étape 2 sur 4');
  });

  it("draws no notch under a cut, the server's or the panel's own, never greyed ones", () => {
    for (const root of [
      drawn(assistOf({ cuts: ['sales_frozen'], saleMoment: moment('good', [true, true, true]) })),
      drawn(
        assistOf({ saleMoment: moment('good', [true, true, true]) }),
        standingOf({ doNotContact: true }, 'hot'),
      ),
    ]) {
      expect(root.querySelector('.cp-notch')).toBeNull();
      expect(place(root)).not.toContain('nv-btn--neon');
    }
  });

  it('lists each condition with its state in the sale detail', () => {
    const root = drawn(assistOf({ saleMoment: moment('soon', [true, false, true]) }));
    const rows = [...root.querySelectorAll('.cp-sale .cp-condition')].map((row) => row.textContent);
    expect(rows).toEqual([
      'Son désir est làacquis',
      'Il n’a pas encore pris le ton coquinmanque',
      'Il est dispoacquis',
    ]);
    // « acquis » is a pill, in the green of success; « manque » a muted word (Design 21/11).
    expect([...root.querySelectorAll('.cp-sale .cp-acquired')].map((n) => n.textContent)).toEqual([
      'acquis',
      'acquis',
    ]);
    expect(root.querySelector('.cp-sale .cp-condition__state')?.textContent).toBe('manque');
  });

  it('tints the desire badge by its band, never in red or amber', () => {
    for (const band of ['neutral', 'playful', 'hot'] as const) {
      const root = draw(onCard(card({}), [], { draft: ready(), standing: standingOf({}, band) })).root;
      const badge = root.querySelector<HTMLElement>('.cp-badge[data-kind="desire"]');
      expect(badge?.dataset['band']).toBe(band);
      expect(badge?.dataset['tone']).toBe('neutral');
    }
  });

  it("drops the desire's tint next to a stop, so it never reads as a second alert", () => {
    const root = drawn(
      assistOf({ cuts: ['sales_frozen'] }),
      standingOf({ salesFrozen: { reason: 'distress', since: now.toISOString() } }, 'hot'),
    );
    const badge = root.querySelector<HTMLElement>('.cp-badge[data-kind="desire"]');
    expect(badge?.textContent).toContain('chaud');
    expect(badge?.dataset['band']).toBeUndefined();
  });

  it('marks each step dot as done, in progress or to come', () => {
    const root = drawn(assistOf());
    expect([...root.querySelectorAll<HTMLElement>('.cp-step')].map((dot) => dot.dataset['step'])).toEqual([
      'done',
      'now',
      'next',
      'next',
    ]);
  });

  it("lights the band with the CRM's halo only while nothing forbids or holds back", () => {
    expect(drawn(assistOf()).querySelector<HTMLElement>('.cp-band')?.dataset['halo']).toBe('true');
    const frozen = drawn(assistOf({ cuts: ['sales_frozen'] }));
    expect(frozen.querySelector<HTMLElement>('.cp-band')?.dataset['halo']).toBeUndefined();
  });

  it("puts a muted icon in front of the card's lines and folds", () => {
    const root = draw(
      onCard(card({ desires: { current: value(['qu’elle prenne les devants']), toCheck: [] } }), [], {
        draft: ready(),
        standing: standingOf({}, 'hot'),
      }),
    ).root;
    expect(root.querySelector('[data-field="desires"] .cp-line-icon svg')).not.toBeNull();
    expect(root.querySelectorAll('.cp-group .cp-line-icon')).toHaveLength(3);
  });
});
