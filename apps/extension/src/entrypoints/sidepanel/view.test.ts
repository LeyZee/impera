// @vitest-environment jsdom
import {
  FAN_CARD_FIELDS,
  FanIdSchema,
  type FanCardEntry,
  type FanCardValue,
  type FanCardView,
  type FanStanding,
} from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import { standingOf } from '../../lib/copilot/standing';

import { moneyWords, render, type DraftPart, type PanelActions, type PanelScreen } from './view';

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
    money?: FanStanding | null;
    newSince?: string | null;
    now?: Date;
  } = {},
): PanelScreen => ({
  kind: 'conversation',
  fanName: patch.fanName ?? null,
  money: patch.money ?? null,
  standing: patch.standing ?? standingOf({}, null),
  cardOn: true,
  opensCreators: true,
  card: view,
  openGroups: new Set(open.filter((g) => g === 'him' || g === 'about_her' || g === 'intimate')),
  newSince: patch.newSince ?? null,
  draft: patch.draft ?? { kind: 'hidden' },
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
    expect(essentials).toEqual(['identity', 'desires', 'limits', 'life_events']);
    const quote = root.querySelector('[data-field="desires"] q');
    expect(quote?.textContent).toBe('<b>j’adore</b> quand tu décides');
    expect(quote?.querySelector('b')).toBeNull();
    expect(root.querySelector('[data-field="limits"] .cp-field__empty')?.textContent).toBe('Pas encore su');
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
    expect([...(same?.querySelectorAll('.cp-field__source') ?? [])].map((n) => n.textContent)).toEqual([
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
    expect(mixed?.querySelector('.cp-ident__line')?.textContent).toBe('Alpha·âge ?·Lyon');
    expect([...(mixed?.querySelectorAll('.cp-field__source') ?? [])].map((n) => n.textContent)).toEqual([
      'Prénom : dit par lui, il y a 3 jours',
      'Ville : noté par Inès, il y a 3 jours',
    ]);
    expect(mixed?.querySelector('.cp-field__quote')?.textContent).toBe('Ville : il a écrit je suis à Lyon');
    expect(mixed?.querySelector('.cp-field__check')?.textContent).toBe(
      'À vérifier, ville : l’agent a lu « Villeurbanne »',
    );
    expect(ident(card({}))?.textContent).toBe('Prénom, âge et ville pas encore sus');

    // The other fields: the label and its source share the first row when there is room (CSS), the value under them;
    // the source is not said again when it is the same.
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
      (name) => root.querySelector(`[data-field="${name}"] > .cp-field__source`)?.textContent ?? null,
    );
    expect(sources).toEqual(['Dit par lui, il y a 3 jours', null, 'Noté par Inès, il y a 3 jours']);
    // After the value in the reading order, so a narrow panel puts it under the value, never alone above it.
    expect(
      [...(root.querySelector('[data-field="desires"]')?.children ?? [])].map((node) => node.className),
    ).toEqual(['cp-field__top', 'cp-field__value', 'cp-field__source']);
    expect(root.querySelector('[data-field="desires"] .cp-field__value')?.textContent).toBe('les talons');
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
    expect(groups.map((g) => g.querySelector('.cp-group__title')?.textContent)).toEqual([
      'Lui',
      'Elle, vue par lui',
      'Intime',
    ]);
    // What is not known yet is said in one line, not as a column of « Pas encore su ».
    const him = groups[0];
    expect(him?.querySelectorAll('.cp-field:not(.cp-field--unknown)').length).toBe(1);
    expect(him?.querySelector('.cp-field--unknown')?.textContent).toMatch(/^Pas encore su : [^A-Z].*\.$/u);
    expect(him?.querySelector('.cp-field__empty')).toBeNull();
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
    expect(root.querySelector('.cp-notice__text')?.textContent).toBe(
      'Elle s’allume dans Créatrices › Agent.',
    );
    expect(root.querySelector('.cp-field')).toBeNull();
    // EXT-17: a chatter has no Créatrices; his manager turns it on.
    const chatter = draw({ ...screen, cardOn: false, opensCreators: false }).root;
    expect(chatter.querySelector('.cp-notice__text')?.textContent).toBe(
      'Demande à ton manager de l’allumer.',
    );
  });

  // EXT-14: the panel says which conversation it shows.
  it('names the fan of the open conversation in a band that does not scroll', () => {
    const { root } = draw(onCard(card({}), [], { fanName: '<i>marc_lyon</i>', draft: ready() }));
    expect([...root.children].map((node) => node.className)).toEqual([
      'cp-who',
      'cp-standing',
      'cp-scroll',
      'cp-draft',
    ]);
    expect(root.querySelector('.cp-who__fan')?.textContent).toBe('<i>marc_lyon</i>');
    expect(root.querySelector('.cp-who i')).toBeNull();
  });

  it('says what he spent, his tier and his last purchase beside his name, never a commission', () => {
    const at = new Date('2026-11-21T14:00:00Z');
    const { root } = draw(
      onCard(card({}), [], {
        fanName: 'fan_invente',
        now: at,
        money: { tier: 'very_good', spentMinor: 25_000, lastPurchaseAt: '2026-11-18T09:00:00Z' },
      }),
    );
    expect(root.querySelector('.cp-who__tier')?.textContent).toBe('Très bon payeur');
    expect(root.querySelector('.cp-who__money')?.textContent).toBe(
      '250\u00a0€ dépensés · dernier achat il y a 3\u00a0j',
    );
    expect(moneyWords({ tier: null, spentMinor: 0, lastPurchaseAt: null }, at)).toBe('rien dépensé');
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
    // No emoji in the interface (V-EXT): his desire is said in words.
    expect(root.querySelector('.cp-standing')?.textContent).toBe('Ventes gelées·Fan fragile·désir joueur');
    // A part and the dot before it hold together at a line's end.
    expect([...root.querySelectorAll('.cp-standing__item')].map((n) => n.textContent)).toEqual([
      '·Fan fragile',
      '·désir joueur',
    ]);
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
    // Charles's word (recette visuelle V-EXT-02): the button says what it does, one verb for the gesture, « copier ».
    expect(buttons.map((b) => b.textContent)).toEqual(['Copier pour Reveal A', 'Retoucher E', 'Refuser R']);
    expect(buttons[0]?.classList.contains('cp-send')).toBe(true);
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
