import { describe, expect, it } from 'vitest';

import { asLastWriting, checkVoiceOutput, DEFAULT_GUARD_SETTINGS, wantsRewrite } from '../guards';
import { openScriptRun, type ScriptRun } from '../script-run';
import { customUnaskedNow, insistsMoreTonight } from '../turn-sale';

// Invented, sober messages (ADR 0010).
const NOW = new Date('2026-11-27T22:00:00Z');
const BOUGHT_AT = new Date('2026-11-27T21:00:00Z');
const bought: ScriptRun = {
  ...openScriptRun('script-demo', new Date('2026-11-27T20:30:00Z')),
  status: 'bought_out',
  steps: [
    { stepIndex: 0, kind: 'paid', outcome: 'bought', priceMinor: 1_000, sentAt: BOUGHT_AT, at: BOUGHT_AT },
  ],
};

describe('a cam or a video made for him is never volunteered (Charles 27/11, passe 3 du 27/11, conversation 18)', () => {
  it('is a soft guard when he did not ask: rewritten once, then blocked', () => {
    const offered = checkVoiceOutput(
      ['Moi je suis comblée', 'mais une cam rien que nous deux, je regarde si c’est possible'],
      DEFAULT_GUARD_SETTINGS,
      { customUnasked: true },
    );
    expect(offered).toContainEqual(expect.objectContaining({ code: 'custom_unasked', severity: 'soft' }));
    expect(wantsRewrite(offered)).toBe(true);
    expect(asLastWriting(offered)).toContainEqual(
      expect.objectContaining({ code: 'custom_unasked', severity: 'blocking' }),
    );
    for (const text of ['une vidéo rien que pour toi, je vois', 'a custom video maybe', 'una videollamada']) {
      expect(
        checkVoiceOutput([text], DEFAULT_GUARD_SETTINGS, { customUnasked: true }).map((v) => v.code),
        text,
      ).toContain('custom_unasked');
    }
  });

  it('lets it pass when code steers him to it or the fact is not given, and reads no cam in ordinary words', () => {
    const text = ['une cam rien que nous deux, je regarde si c’est possible'];
    expect(checkVoiceOutput(text, DEFAULT_GUARD_SETTINGS).map((v) => v.code)).not.toContain('custom_unasked');
    expect(
      checkVoiceOutput(['je visionne une série, rien de spécial'], DEFAULT_GUARD_SETTINGS, {
        customUnasked: true,
      }).map((v) => v.code),
    ).not.toContain('custom_unasked');
  });

  it('knows when he asked: his words, the brain’s reading, a rule of code or a step in her answer', () => {
    const base = {
      customLed: false,
      hasStep: false,
      intent: 'asks_for_media',
      fanText: 'encore ?',
      history: [],
    };
    expect(customUnaskedNow(base)).toBe(true);
    expect(customUnaskedNow({ ...base, fanText: 'tu fais des cams ?' })).toBe(false);
    expect(customUnaskedNow({ ...base, intent: 'asks_for_service' })).toBe(false);
    expect(customUnaskedNow({ ...base, customLed: true })).toBe(false);
    expect(customUnaskedNow({ ...base, hasStep: true })).toBe(false);
    expect(customUnaskedNow({ ...base, history: [{ from: 'fan', text: 'une vidéo perso un jour ?' }] })).toBe(
      false,
    );
  });

  it('reads his insisting after his script: an earlier ask since his purchase, or a cam asked now', () => {
    const asked = [
      {
        from: 'fan' as const,
        text: 'T’as encore quelque chose pour moi',
        at: new Date('2026-11-27T21:40:00Z'),
      },
      { from: 'creator' as const, text: 'Je suis comblée moi', at: new Date('2026-11-27T21:41:00Z') },
      { from: 'fan' as const, text: 'Allez', at: NOW },
    ];
    expect(insistsMoreTonight('Allez', asked, bought)).toBe(true);
    // His first ask, nothing before: no steer.
    expect(insistsMoreTonight('T’as encore quelque chose pour moi', asked.slice(0, 1), bought)).toBe(false);
    // An ask from before his purchase does not count.
    const before = asked.map((turn, index) =>
      index === 0 ? { ...turn, at: new Date('2026-11-27T20:00:00Z') } : turn,
    );
    expect(insistsMoreTonight('Allez', before, bought)).toBe(false);
    expect(insistsMoreTonight('Et en cam ce soir ?', [], bought)).toBe(true);
    expect(insistsMoreTonight('Allez', asked, null)).toBe(false);
  });
});
