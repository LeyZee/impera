import { describe, expect, it } from 'vitest';

import { SCRIPT_STARTERS } from './script-starters';
import { scriptCardInk, scriptSegmentCodes, scriptStructureFaults } from './scripts';

describe('starter structures', () => {
  it('break no structure rule and read on their colour', () => {
    expect(SCRIPT_STARTERS.length).toBeGreaterThan(0);
    for (const starter of SCRIPT_STARTERS) {
      expect(scriptStructureFaults(starter.body.segments), starter.key).toEqual([]);
      expect(scriptCardInk(starter.body.color), starter.key).not.toBeNull();
    }
    expect(new Set(SCRIPT_STARTERS.map((starter) => starter.key)).size).toBe(SCRIPT_STARTERS.length);
  });

  it('keep OnlyScript’s stage names and its bridges from 2 & 3 to 5 & 6 (ADR 0064 § 4)', () => {
    const onlyscript = SCRIPT_STARTERS.find((starter) => starter.key === 'onlyscript');
    if (onlyscript === undefined) throw new Error('no OnlyScript starter');
    const { segments } = onlyscript.body;
    expect(segments.flatMap((segment) => (segment.kind === 'stage' ? [segment.name] : []))).toEqual([
      'Teasing',
      'Seins',
      'Chatte',
      'Masturbation',
      'Jeux God',
      'Pénétration',
      'Orgasme',
    ]);
    const codes = new Map(scriptSegmentCodes(segments).map((code) => [code.key, code.code]));
    expect(
      segments.flatMap((segment) =>
        segment.kind === 'bridge'
          ? [`${codes.get(segment.from) ?? ''} & ${codes.get(segment.to) ?? ''}`]
          : [],
      ),
    ).toEqual(['E2 & E3', 'E3 & E4', 'E4 & E5', 'E5 & E6']);
    const [teasing] = segments;
    expect(teasing).toMatchObject({
      access: 'free',
      variants: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }],
    });
    expect(
      segments.every(
        (segment) => segment.kind === 'bridge' || segment.key === 'teasing' || segment.access === 'paid',
      ),
    ).toBe(true);
  });
});
