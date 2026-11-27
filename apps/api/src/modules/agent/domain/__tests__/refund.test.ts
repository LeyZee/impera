import { describe, expect, it } from 'vitest';

import { asLastWriting, checkVoiceOutput, DEFAULT_GUARD_SETTINGS, wantsRewrite } from '../guards';
import { askedRefundLately, asksForRefund, refundInDraft } from '../refund';

// Invented, sober messages (ADR 0010).
describe('he asks for a refund (ADR 0158 § 48, avenant du 27/11)', () => {
  it.each([
    'Je veux être remboursé',
    'Tu peux me rembourser ?',
    'Rembourse-moi stp',
    'je veux un remboursement, c’était nul',
    'Rendez-moi mon argent',
    'je veux mon argent',
    'je voudrais récupérer mes sous',
    'I want a refund',
    'Can I get my money back?',
    'please reimburse me',
    'Quiero un reembolso',
    'Devuélveme mi dinero',
    'quiero mi dinero',
    'Voglio un rimborso',
    'ridammi i soldi',
    'rivoglio i miei soldi',
    'voglio i soldi indietro',
    'franchement déçu, je veux un remboursement',
    'je suis pas content je veux un remboursement',
  ])('reads « %s » as asking', (text) => {
    expect(asksForRefund(text)).toBe(true);
  });

  it.each([
    'je veux pas de remboursement, juste te dire que c’était court',
    'Je ne veux pas être remboursé',
    'pas besoin de remboursement',
    'je demande pas à être remboursé',
    'I don’t want a refund',
    'not asking for a refund',
    'no quiero un reembolso',
    'non voglio un rimborso',
    'je dois rembourser mon crédit ce mois-ci',
    'franchement déçu, c’était trop court',
    'j’ai pas mon argent avant vendredi',
    'tu me rends fou',
  ])('does not read « %s » as asking', (text) => {
    expect(asksForRefund(text)).toBe(false);
  });

  it('counts his last three turns, then forgets', () => {
    const asked = { fromFan: true, text: 'je veux être remboursé' };
    const her = { fromFan: false, text: 'Ça se fait sur Reveal' };
    const his = (text: string) => ({ fromFan: true, text });
    expect(askedRefundLately([asked])).toBe(true);
    expect(askedRefundLately([asked, her, his('comment ?')])).toBe(true);
    expect(askedRefundLately([asked, her, his('ok'), her, his('et après ?')])).toBe(true);
    expect(askedRefundLately([asked, her, his('ok'), her, his('bon'), her, his('bref')])).toBe(false);
    // Several messages of his in a row are one turn.
    expect(askedRefundLately([asked, his('stp'), her, his('ok'), her, his('et après ?')])).toBe(true);
    expect(askedRefundLately([his('c’était court'), her])).toBe(false);
  });
});

describe('a refund in her answer (ADR 0158 § 48, avenant du 27/11)', () => {
  it('lets her say it is done on Reveal when he asked, never unasked', () => {
    const reveal = ['Ça se fait directement sur Reveal pour le remboursement'];
    expect(refundInDraft(reveal, true)).toBeNull();
    expect(refundInDraft(reveal, false)?.kind).toBe('unasked');
    expect(refundInDraft(['Tu peux demander un refund on Reveal'], false)?.kind).toBe('unasked');
    expect(refundInDraft(['Dis-moi ce qui ne t’a pas plu'], false)).toBeNull();
  });

  it.each([
    'Je te rembourse, promis',
    'je vais te rembourser',
    'je te rends ton argent',
    'tu seras remboursé',
    'I’ll refund you',
    'I will give you your money back',
    'te reembolso ahora',
    'te devuelvo el dinero',
    'ti rimborso subito',
    'sarai rimborsato',
  ])('blocks « %s » as a promise, asked or not', (text) => {
    expect(refundInDraft([text], true)?.kind).toBe('promise');
    expect(refundInDraft([text], false)?.kind).toBe('promise');
  });

  it.each(['je te rends fou', 'ti rido in faccia', 'je vais te dire un truc'])(
    'reads « %s » as no refund',
    (text) => {
      expect(refundInDraft([text], false)).toBeNull();
    },
  );

  it('is a soft guard first, rewritten, then blocks; a promise blocks at once', () => {
    const unasked = checkVoiceOutput(['Tu peux demander un remboursement à Reveal'], DEFAULT_GUARD_SETTINGS, {
      fanAskedRefund: false,
    });
    expect(unasked).toContainEqual(expect.objectContaining({ code: 'refund_unasked', severity: 'soft' }));
    expect(wantsRewrite(unasked)).toBe(true);
    expect(asLastWriting(unasked)).toContainEqual(
      expect.objectContaining({ code: 'refund_unasked', severity: 'blocking' }),
    );
    expect(
      checkVoiceOutput(['Ça se fait sur Reveal, le remboursement'], DEFAULT_GUARD_SETTINGS, {
        fanAskedRefund: true,
      }).filter((v) => v.code.startsWith('refund')),
    ).toEqual([]);
    expect(
      checkVoiceOutput(['Je te rembourse'], DEFAULT_GUARD_SETTINGS, { fanAskedRefund: true }),
    ).toContainEqual(expect.objectContaining({ code: 'refund_promise', severity: 'blocking' }));
    // Without the fact, a mention is not read; a promise always is.
    expect(
      checkVoiceOutput(['Ça se fait sur Reveal, le remboursement'], DEFAULT_GUARD_SETTINGS).map(
        (v) => v.code,
      ),
    ).not.toContain('refund_unasked');
    expect(checkVoiceOutput(['Je te rembourse'], DEFAULT_GUARD_SETTINGS).map((v) => v.code)).toContain(
      'refund_promise',
    );
  });
});
