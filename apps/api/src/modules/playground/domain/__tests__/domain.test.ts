import { describe, expect, it } from 'vitest';

import { FAN_PRESETS } from '../fan-presets';
import { gateMissingLabel, guardLabel, trapLabel } from '../labels';
import { completeMedia } from '../media';

describe('playground domain', () => {
  it('writes guards and traps in French, falling back to the code', () => {
    expect(guardLabel('ai_disclosure')).toBe('Elle dit ou laisse entendre qu’elle est une IA');
    expect(guardLabel('new_guard')).toBe('new_guard');
    expect(trapLabel('off_topic_task', 'media')).toBe(
      'Il lui demande une tâche hors sujet (recette, code, devoir), dans son média',
    );
  });

  it('claims nothing beyond the trainer’s words, and keeps the flags', () => {
    const media = completeMedia({ kind: 'video', factualDescription: 'Une vidéo floue.', flags: ['weapon'] });
    expect(media).toMatchObject({
      kind: 'video',
      intensity: 'not_visible',
      anatomyVisible: [],
      confidenceLow: true,
      flags: ['weapon'],
    });
    expect(completeMedia({ kind: 'image', factualDescription: 'Un chat.' }).flags).toEqual([]);
  });

  it('names only what the gate still misses of his availability (ADR 0103 § 14)', () => {
    const missing = (state: string, seen: string[]) =>
      gateMissingLabel('availability_unconfirmed', { state, seen });
    expect(missing('unknown', ['alone', 'at_home'])).toBe('Il n’a pas dit qu’il a du temps');
    expect(missing('unknown', ['free_now'])).toBe('Il n’a pas dit qu’il est seul');
    expect(missing('unknown', [])).toBe('Il n’a pas dit être seul et libre');
    expect(missing('no', [])).toBe('Il a dit ne pas être libre');
    expect(gateMissingLabel('not_sexualizing', { state: 'unknown', seen: [] })).toBe(
      'Il ne sexualise pas encore lui-même',
    );
  });

  it('gives an adult age to every simulated fan she already knows, and none to those who test it (audit H6)', () => {
    const untold = FAN_PRESETS.filter((p) => p.declaredAge === null).map((p) => p.id);
    expect(untold).toEqual(['nouveau', 'mineur', 'piegeur']);
    for (const preset of FAN_PRESETS) {
      if (preset.declaredAge === null) continue;
      expect(preset.declaredAge).toBeGreaterThanOrEqual(18);
      // Her notes say it too, as the card of a real fan would.
      expect(preset.fanNotes).toContain(`identity / age : ${String(preset.declaredAge)} (declared)`);
    }
  });
});
