import { CopilotAssistSchema, type CopilotAssist, type CopilotNextMove } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  CUT_LINES,
  cutOf,
  draftNotes,
  eurosOf,
  conditionWords,
  momentLine,
  moveLines,
  saleLine,
  saleRows,
  stepDots,
} from './assist';
import { standingOf } from './standing';

/* Invented data (ADR 0010). */
const assist = (patch: Partial<CopilotAssist> = {}): CopilotAssist =>
  CopilotAssistSchema.parse({
    nextMove: { kind: 'reply', label: 'Répondre', priceMinor: null, block: null },
    reasons: [],
    sale: {
      script: { name: 'Soirée d’essai', stepIndex: 1, stepCount: 4 },
      nextStep: { name: 'Étape 3', priceMinor: 1500 },
      refusedSteps: [],
      usedObjections: [],
      customOrderOpen: false,
      offerPending: false,
    },
    signals: { desireTrend: null, followUpDue: false },
    cuts: [],
    buttons: [],
    clicksLeftToday: 30,
    ...patch,
  });

/** Nothing known of his desire nor of a script. */
const bare = { band: null, sale: null } as const;

const move = (kind: CopilotNextMove['kind'], label: string, block: CopilotNextMove['block'] = null) => ({
  kind,
  label,
  priceMinor: kind === 'offer_step' ? 1500 : null,
  block,
});

describe('what the agent computed, said to the chatter (ADR 0141, lot a)', () => {
  it.each([
    ['reply', 'Répondre'],
    ['offer_step', 'Proposer «\u00a0Étape 3\u00a0» à 15 €'],
    ['answer_objection', 'Répondre à son objection'],
    ['custom_order_accept', 'Commande perso : accepter'],
    ['custom_order_decline', 'Commande perso : refuser'],
    ['custom_order_wait', 'Commande perso : attendre'],
    ['wait', 'Attendre avant de répondre'],
    ['hand_over', 'Rendre la main à un humain'],
  ] as const)('says the gesture %s as the server words it, in a neutral tone', (kind, label) => {
    expect(moveLines(move(kind, label), [], bare)).toEqual({ what: label, why: null, tone: 'neutral' });
  });

  it('says the moment to sell as the title, with the step and the price of the code (maquette v4, 27/11)', () => {
    const { sale } = assist();
    const offer = move('offer_step', 'Proposer «\u00a0Étape 3\u00a0» à 15 €');
    const lines = moveLines(offer, [], { band: 'hot', sale, moment: 'good' });
    expect(lines.tone).toBe('good');
    expect(lines.what).toMatch(/^C’est le moment\u00a0: «\u00a0.+\u00a0» à \d+/u);
    expect(lines.why).toBe('Désir chaud, étape 2 sur 4');
    // Not before the code says the moment is good, nor without a step to offer.
    expect(moveLines(offer, [], { band: 'hot', sale, moment: 'soon' }).tone).toBe('neutral');
    expect(moveLines(offer, [], { band: 'hot', sale: null, moment: 'good' }).what).toBe(offer.label);
    expect(moveLines(move('reply', 'Répondre'), [], { band: 'hot', sale, moment: 'good' }).tone).toBe(
      'neutral',
    );
  });

  // Design 16/11: the why of a proposal is the reason to propose, from what is known, no number invented.
  it('says why a step is proposed: his desire and where the script stands', () => {
    const { sale } = assist();
    const offer = move('offer_step', 'Proposer «\u00a0Étape 3\u00a0» à 15 €');
    expect(moveLines(offer, [], { band: 'hot', sale }).why).toBe('Désir chaud, étape 2 sur 4');
    expect(moveLines(offer, [], { band: null, sale }).why).toBe('Étape 2 sur 4');
    expect(moveLines(offer, [], { band: 'playful', sale: null }).why).toBe('Désir joueur');
    // Only a proposal says it: a reply has no reason to sell.
    expect(moveLines(move('reply', 'Répondre'), [], { band: 'hot', sale }).why).toBeNull();
  });

  // Design 16/11: « Réécrit une fois par une garde » is a note on the draft, not a reason for the gesture.
  it('keeps the notes on the draft out of « pourquoi », and gives them to the draft', () => {
    const reasons = [
      { code: 'rewritten_once', label: 'Réécrit une fois par une garde' },
      { code: 'media_not_seen', label: 'Un média de lui n’est pas encore lu' },
      { code: 'handoff', label: 'Il faut un humain' },
    ] as const;
    expect(moveLines(move('hand_over', 'Rendre la main à un humain'), [...reasons], bare).why).toBe(
      'Il faut un humain',
    );
    expect(moveLines(move('reply', 'Répondre'), [reasons[0]], bare).why).toBeNull();
    expect(draftNotes([...reasons])).toEqual([
      'Réécrit une fois par une garde',
      'Un média de lui n’est pas encore lu',
    ]);
  });

  it('says why under the gesture: the sale block first, then the gesture’s reasons', () => {
    expect(
      moveLines(
        move('no_sale', 'Ne rien vendre', 'low_desire'),
        [
          { code: 'care', label: 'Fan fragile' },
          { code: 'rewritten_once', label: 'Réécrit une fois par une garde' },
        ],
        { band: 'neutral', sale: null },
      ),
    ).toEqual({
      what: 'Ne rien vendre',
      why: 'Désir encore trop bas · Fan fragile',
      tone: 'amber',
    });
    // One tone per state (§ 12, Design 16/11): red for « Ne plus lui écrire » and « Ventes gelées », as on the top line;
    // an age not confirmed yet is not a contested age.
    expect(moveLines(move('no_sale', 'Ne rien vendre', 'do_not_contact'), [], bare).tone).toBe('red');
    expect(moveLines(move('no_sale', 'Ne rien vendre', 'sales_frozen'), [], bare).tone).toBe('red');
    expect(moveLines(move('no_sale', 'Ne rien vendre', 'age_unconfirmed'), [], bare).tone).toBe('amber');
    // The server's label wins when it sends one; the local words are only the fallback.
    expect(
      moveLines(
        { ...move('no_sale', 'Ne rien vendre', 'cooldown'), blockLabel: 'Offre faite il y a peu' },
        [],
        bare,
      ).why,
    ).toBe('Offre faite il y a peu');
    expect(
      moveLines(
        move('hand_over', 'Rendre la main à un humain'),
        [{ code: 'handoff', label: 'Il faut un humain' }],
        bare,
      ).why,
    ).toBe('Il faut un humain');
  });

  it('cuts the sale on the server’s word, and on its own when his limits are not read or forbid a word', () => {
    const calm = standingOf({}, null);
    expect(cutOf(assist(), calm)).toBeNull();
    expect(cutOf(null, calm)).toBeNull();
    expect(cutOf(assist({ cuts: ['sales_frozen', 'care'] }), calm)).toBe('care');
    expect(cutOf(assist({ cuts: ['care_exit', 'age_doubt'] }), calm)).toBe('age_doubt');
    expect(cutOf(assist(), standingOf('unread', null))).toBe('limits_unread');
    expect(cutOf(null, standingOf({ doNotContact: true }, null))).toBe('do_not_contact');
    // A contested age read by the panel cuts too, whatever the server offers (closed by default).
    expect(
      cutOf(assist(), standingOf({ ageDisputed: { since: '2026-11-08T18:00:00Z', by: 'human' } }, 'hot')),
    ).toBe('age_doubt');
  });

  // Design 16/11: one tone per state, the glossary's words, and « relis le brouillon » said once, in the sentence.
  it('says each cut in one sentence, in the tone of its word on the top line', () => {
    expect(CUT_LINES.age_doubt).toEqual({
      text: 'Âge contesté\u00a0: un humain doit le lever avant tout.',
      tone: 'red',
    });
    expect(CUT_LINES.sales_frozen).toEqual({
      text: 'Ventes gelées\u00a0: on ne lui vend rien. Relis le brouillon avant de l’envoyer.',
      tone: 'red',
    });
    expect(CUT_LINES.care).toEqual({
      text: 'Fan fragile\u00a0: on ne lui vend rien. Relis le brouillon avant de l’envoyer.',
      tone: 'amber',
    });
    expect(CUT_LINES.care_exit.tone).toBe('amber');
    expect(CUT_LINES.care_exit.text).toMatch(/^Fan fragile/);
    expect(CUT_LINES.do_not_contact.tone).toBe('red');
    expect(CUT_LINES.limits_unread.tone).toBe('amber');
    for (const { text } of Object.values(CUT_LINES)) expect(text).not.toMatch(/difficult|Doute sur son âge/);
  });

  it('writes a price of the code in euros', () => {
    expect(eurosOf(1500)).toBe('15\u00a0€');
    expect(eurosOf(1490)).toBe('14,90\u00a0€');
    expect(eurosOf(0)).toBe('0\u00a0€');
  });

  it('says the sale in one line: the script and its step, then the next step and its price', () => {
    const { sale } = assist();
    if (sale === null) throw new Error('sale');
    // A step's name between guillemets (Design 16/11), the step as « 2/4 » (Design, lot 0141-3).
    expect(saleLine(sale)).toBe('Soirée d’essai 2/4 · ensuite «\u00a0Étape 3\u00a0» 15\u00a0€');
    expect(saleLine({ ...sale, nextStep: null })).toBe('Soirée d’essai 2/4');
    expect(saleLine({ ...sale, script: null })).toBe('Prochaine étape «\u00a0Étape 3\u00a0» 15\u00a0€');
    expect(saleLine({ ...sale, script: null, nextStep: null })).toBe(
      'Rien de vendu ni proposé pour l’instant',
    ); // Under « Ne rien vendre », the line keeps the script and its step, not the next step and its price.
    expect(saleLine(sale, { withNext: false })).toBe('Soirée d’essai 2/4');
  });

  it('draws one dot per step, past, in progress and to come, none without a script or for a long one', () => {
    const { sale } = assist();
    const script = sale?.script;
    if (sale === null || script === null || script === undefined) throw new Error('sale');
    expect(stepDots(sale)).toEqual(['done', 'now', 'next', 'next']);
    expect(stepDots({ ...sale, script: null })).toEqual([]);
    expect(stepDots({ ...sale, script: { ...script, stepCount: 12 } })).toEqual([]);
  });

  it('opens on what the line does not say, step names quoted', () => {
    const { sale } = assist();
    if (sale === null) throw new Error('sale');
    expect(saleRows(sale)).toEqual([]);
    const rows = saleRows({
      ...sale,
      offerPending: true,
      refusedSteps: ['Étape 2'],
      usedObjections: ['C’est trop cher'],
      customOrderOpen: true,
    });
    expect(rows.map(({ label }) => label)).toEqual([
      'Offre faite',
      'Étapes refusées',
      'Objections déjà servies',
      'Commande perso',
    ]);
    // One pill per element, the pill bounding the name (Design 21/11); the offer waits with the hourglass.
    expect(rows.find(({ label }) => label === 'Étapes refusées')?.value).toEqual(['Étape 2']);
    expect(rows.find(({ label }) => label === 'Objections déjà servies')?.value).toEqual(['C’est trop cher']);
    expect(rows[0]).toEqual({ label: 'Offre faite', value: 'Pas encore de réponse', waiting: true });
    // What the line leaves out, the detail says: the next step first, quoted, with its price.
    expect(saleRows(sale, { withNext: true })[0]).toEqual({
      label: 'Prochaine étape',
      value: '«\u00a0Étape 3\u00a0» 15\u00a0€',
    });
  });
});

describe('the moment to sell (ADR 0141 § 4 bis)', () => {
  const noSale = (block: 'low_desire' | 'risk' | 'cooldown') => ({
    kind: 'no_sale' as const,
    label: 'Ne rien vendre',
    priceMinor: null,
    block,
  });

  it("says the verdict in the panel's words, then what is missing, one notch per condition", () => {
    expect(
      momentLine(
        {
          verdict: 'not_yet',
          conditions: [
            { code: 'desire_below_threshold', met: false },
            { code: 'not_sexualizing', met: false },
            { code: 'availability_unconfirmed', met: true },
          ],
        },
        null,
      ),
    ).toEqual({
      // The met ones first, the missing ones on the right.
      notches: [true, false, false],
      text: 'Pas encore · il manque son désir',
      more: 1,
      verdict: 'not_yet',
    });
    expect(
      momentLine({ verdict: 'soon', conditions: [{ code: 'step_waiting', met: false }] }, null).text,
    ).toBe('Bientôt · il manque l’achat de l’étape');
  });

  it('names the first missing condition, in the fold order, and counts the others', () => {
    const three = momentLine(
      {
        verdict: 'not_yet',
        conditions: [
          { code: 'not_sexualizing', met: false },
          { code: 'cooldown', met: false },
          { code: 'availability_unconfirmed', met: false },
        ],
      },
      null,
    );
    expect(three.text).toBe('Pas encore · il manque le ton coquin');
    expect(three.more).toBe(2);
    const two = momentLine(
      {
        verdict: 'not_yet',
        conditions: [
          { code: 'cooldown', met: false },
          { code: 'not_sexualizing', met: false },
          { code: 'desire_below_threshold', met: true },
        ],
      },
      null,
    );
    expect(two.text).toBe('Pas encore · il manque du temps depuis l’offre');
    expect(two.more).toBe(1);
    expect(
      momentLine({ verdict: 'good', conditions: [{ code: 'fan_asks_for_paid', met: true }] }, null).more,
    ).toBe(0);
  });

  it('says a met condition positively in the detail', () => {
    expect(conditionWords({ code: 'desire_below_threshold', met: true })).toBe('Son désir est là');
    expect(conditionWords({ code: 'not_sexualizing', met: true })).toBe('Il a pris le ton coquin');
    expect(conditionWords({ code: 'availability_unconfirmed', met: true })).toBe('Il est dispo');
    expect(conditionWords({ code: 'cooldown', met: true })).toBe('Pas d’offre trop récente');
    expect(conditionWords({ code: 'no_budget', met: true })).toBe('Pas de frein d’argent connu');
    expect(conditionWords({ code: 'step_waiting', met: true })).toBe('Pas d’offre en attente');
    expect(conditionWords({ code: 'age_unconfirmed', met: true })).toBe('Âge confirmé');
    expect(conditionWords({ code: 'fan_messages', met: true, remaining: null })).toBe('Il a assez écrit');
  });

  it('says why the moment is good when he asks for content himself', () => {
    expect(
      momentLine({ verdict: 'good', conditions: [{ code: 'fan_asks_for_paid', met: true }] }, null),
    ).toEqual({
      notches: [true],
      text: 'Bon moment · il demande du contenu lui-même',
      more: 0,
      verdict: 'good',
    });
    expect(momentLine({ verdict: 'good', conditions: [] }, null).text).toBe('Bon moment');
  });

  it('gives the hour a cooldown ends, the way the CRM writes it', () => {
    const until = new Date(2026, 10, 16, 18, 20).toISOString();
    const moment = {
      verdict: 'not_yet' as const,
      conditions: [{ code: 'cooldown' as const, met: false, until }],
    };
    // The line says it short; the detail gives the hour.
    expect(momentLine(moment, null).text).toBe('Pas encore · il manque du temps depuis l’offre');
    expect(conditionWords({ code: 'cooldown', met: false, until })).toBe(
      'Une offre est trop récente, jusqu’à 18\u00a0h\u00a020',
    );
    expect(conditionWords({ code: 'cooldown', met: false, until: null })).toBe('Une offre est trop récente');
  });

  it('counts the messages still needed from him, when the server knows it', () => {
    expect(conditionWords({ code: 'fan_messages', met: false, remaining: 1 })).toBe(
      'Il faut encore 1\u00a0message de lui',
    );
    expect(conditionWords({ code: 'fan_messages', met: false, remaining: 3 })).toBe(
      'Il faut encore 3\u00a0messages de lui',
    );
    expect(conditionWords({ code: 'fan_messages', met: false, remaining: null })).toBe(
      'Il faut encore des messages de lui',
    );
    expect(conditionWords({ code: 'fan_messages', met: false })).toBe('Il faut encore des messages de lui');
    expect(
      momentLine({ verdict: 'soon', conditions: [{ code: 'fan_messages', met: false, remaining: 2 }] }, null)
        .text,
    ).toBe('Bientôt · il manque des messages de lui');
  });

  it('adds a block of the code that no condition sent says, never one it already says', () => {
    const moment = {
      verdict: 'not_yet' as const,
      conditions: [
        { code: 'desire_below_threshold' as const, met: false },
        { code: 'not_sexualizing' as const, met: true },
      ],
    };
    expect(momentLine(moment, noSale('low_desire')).text).toBe('Pas encore · il manque son désir');
    expect(momentLine(moment, noSale('risk')).text).toBe(
      'Pas encore · Un risque bloque la vente · il manque son désir',
    );
    // A cooldown the server did not send as a condition is still said.
    expect(momentLine(moment, noSale('cooldown')).text).toBe(
      'Pas encore · Offre trop récente · il manque son désir',
    );
  });
});
