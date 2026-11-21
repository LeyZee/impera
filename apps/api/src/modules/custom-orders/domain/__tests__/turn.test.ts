import { emptyCustomPriceGrid, type CustomOrderReading, type CustomPriceGrid } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  CUSTOM_ORDER_DECLINE_BRIEF,
  CUSTOM_ORDER_HOLD_BRIEF,
  CUSTOM_ORDER_WAIT_BRIEF,
  customOrderTurn,
  missingDetails,
  type CustomOrderTurnInput,
} from '../turn';

/* Neutral test numbers and names, never the agency's (ADR 0010). */
function grid(): CustomPriceGrid {
  const empty = emptyCustomPriceGrid();
  return {
    formats: empty.formats.map((line) =>
      line.format === 'video_call_sexual' ? { ...line, offered: false } : { ...line, priceMinor: 1_000 },
    ),
    supplements: [
      { id: 'sup_0000000a', label: 'Test A', offered: true, percent: 50 },
      { id: 'sup_0000000b', label: 'Test B', offered: false, percent: null },
    ],
  };
}

const reading = (patch: Partial<CustomOrderReading> = {}): CustomOrderReading => ({
  format: null,
  supplements: [],
  minutes: null,
  details: {},
  ...patch,
});

const input = (patch: Partial<CustomOrderTurnInput> = {}): CustomOrderTurnInput => ({
  asksForService: true,
  reading: reading(),
  order: null,
  stop: 'none',
  chatterOnShift: false,
  grid: grid(),
  ...patch,
});

/** Every brief commits to nothing: the words of the promise are absent, the refusal of any other payment is there. */
const promiseWords = /\d|€|euros?|\bprix de\b|\bdemain\b|\bje te (la |le )?fais\b/iu;

describe('her turn on a custom order, before her yes (ADR 0159 § A.2)', () => {
  it('is nothing when he asks nothing and no order is open', () => {
    expect(customOrderTurn(input({ asksForService: false, reading: null }))).toEqual({ kind: 'none' });
  });

  it('asks first what he imagines, one light question, under both guards', () => {
    const turn = customOrderTurn(input());
    expect(turn).toMatchObject({
      kind: 'reply',
      guards: ['no_commitment', 'no_tip_request'],
      order: { state: 'gathering', questionsAsked: 1 },
      event: { type: 'custom_order_gathering', asked: 'format' },
    });
    if (turn.kind !== 'reply') throw new Error('no reply');
    expect(turn.brief).toMatch(/une seule chose/u);
    expect(turn.brief).toMatch(/sans aucun prix/u);
    expect(turn.brief).toMatch(/autre moyen de paiement/u);
    expect(turn.brief).not.toMatch(promiseWords);
  });

  it('asks the essential details of the format, in order, and never his own words', () => {
    const first = customOrderTurn(
      input({ reading: reading({ format: 'video', details: { what: 'TEST-SECRET' } }) }),
    );
    expect(first).toMatchObject({ event: { asked: 'duration' } });
    if (first.kind !== 'reply' || first.order === null) throw new Error('no order');
    expect(first.brief).not.toContain('TEST-SECRET');
    const second = customOrderTurn(input({ order: first.order, reading: reading({ minutes: 4 }) }));
    expect(second).toMatchObject({ event: { asked: 'when' }, order: { questionsAsked: 2, minutes: 4 } });
  });

  it('sends a complete card to her, with the price of her grid, and keeps him warm', () => {
    const turn = customOrderTurn(
      input({
        reading: reading({
          format: 'video',
          supplements: ['sup_0000000a'],
          minutes: 3,
          details: { what: 'Test', when: 'Test' },
        }),
      }),
    );
    expect(turn).toMatchObject({
      kind: 'reply',
      brief: CUSTOM_ORDER_WAIT_BRIEF,
      order: { state: 'awaiting_creator', questionsAsked: 0 },
      event: {
        type: 'custom_order_card_ready',
        card: { to: 'creator', missing: [], quote: { kind: 'price', totalMinor: 1_500 } },
      },
    });
  });

  it('sends the card to the owner after three questions without the details', () => {
    let order = null;
    for (let question = 1; question <= 3; question += 1) {
      const turn = customOrderTurn(
        input({ order, reading: reading({ format: question === 1 ? 'photo' : null }) }),
      );
      if (turn.kind !== 'reply') throw new Error('no reply');
      order = turn.order;
    }
    expect(order).toMatchObject({ questionsAsked: 3, state: 'gathering' });
    const last = customOrderTurn(input({ order, reading: reading() }));
    expect(last).toMatchObject({
      brief: CUSTOM_ORDER_WAIT_BRIEF,
      order: { state: 'awaiting_creator' },
      event: { type: 'custom_order_card_ready', card: { to: 'owner', missing: ['what', 'when'] } },
    });
  });

  it('keeps him warm while the card waits for her, with no new card', () => {
    const waiting = {
      state: 'awaiting_creator' as const,
      format: 'photo' as const,
      supplements: [],
      minutes: null,
      details: { what: 'Test', when: 'Test' },
      questionsAsked: 1,
    };
    const turn = customOrderTurn(input({ order: waiting }));
    expect(turn).toEqual({
      kind: 'reply',
      brief: CUSTOM_ORDER_WAIT_BRIEF,
      guards: ['no_commitment', 'no_tip_request'],
      order: waiting,
    });
  });

  it('lets the conversation go on when an open order is not spoken of', () => {
    const order = { ...missingOrder(), questionsAsked: 1 };
    expect(customOrderTurn(input({ asksForService: false, reading: null, order }))).toEqual({ kind: 'none' });
  });

  it('declines without asking her what her grid says she never does, format or supplement', () => {
    for (const read of [
      reading({ format: 'video_call_sexual' }),
      reading({ format: 'photo', supplements: ['sup_0000000b'] }),
    ])
      expect(customOrderTurn(input({ reading: read }))).toMatchObject({
        brief: CUSTOM_ORDER_DECLINE_BRIEF,
        order: null,
        event: { type: 'custom_order_declined', by: 'grid' },
      });
  });

  it('puts the rules that come first before any question: no sale, never does, hold', () => {
    expect(customOrderTurn(input({ stop: 'no_sale' }))).toMatchObject({
      brief: CUSTOM_ORDER_DECLINE_BRIEF,
      order: null,
      event: { by: 'no_sale' },
    });
    expect(customOrderTurn(input({ stop: 'never_does' }))).toMatchObject({ event: { by: 'never_does' } });
    expect(customOrderTurn(input({ stop: 'hold' }))).toEqual({
      kind: 'reply',
      brief: CUSTOM_ORDER_HOLD_BRIEF,
      guards: ['no_commitment', 'no_tip_request'],
      order: null,
    });
  });

  it('hands a new order to a chatter on shift, with what was read', () => {
    expect(
      customOrderTurn(input({ chatterOnShift: true, reading: reading({ format: 'call' }) })),
    ).toMatchObject({
      kind: 'handoff',
      order: { state: 'gathering', format: 'call' },
    });
  });

  it('leaves an order past her answer to the next steps', () => {
    expect(customOrderTurn(input({ order: { ...missingOrder(), state: 'creator_yes' } }))).toEqual({
      kind: 'none',
    });
  });

  it('sends a card with no price when the owner never filled in a grid', () => {
    const turn = customOrderTurn(
      input({ grid: null, reading: reading({ format: 'photo', details: { what: 'Test', when: 'Test' } }) }),
    );
    expect(turn).toMatchObject({ event: { card: { to: 'creator', quote: null } } });
  });
});

describe('missingDetails', () => {
  it('counts the minutes read as the duration', () => {
    expect(missingDetails({ ...missingOrder(), format: 'call', minutes: 10 })).toEqual(['availability']);
    expect(missingDetails({ ...missingOrder(), format: 'call' })).toEqual(['duration', 'availability']);
    expect(missingDetails(missingOrder())).toEqual(['format']);
  });
});

function missingOrder() {
  return {
    state: 'gathering' as const,
    format: null,
    supplements: [],
    minutes: null,
    details: {},
    questionsAsked: 0,
  };
}
