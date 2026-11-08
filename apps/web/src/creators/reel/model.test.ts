import { describe, expect, it } from 'vitest';

import {
  addShot,
  clampSeconds,
  emptyReelDraft,
  HOOK_COUNTER,
  isBlank,
  moveShot,
  previewOf,
  reelBriefOf,
  reelDraftOf,
  reelProblems,
  removeShot,
  setShot,
  typedWords,
} from './model';

// Invented sentences only (ADR 0010).
const filledDraft = () => {
  let draft = emptyReelDraft();
  const [first, second] = draft.shots;
  if (first === undefined || second === undefined) throw new Error('two shots');
  draft = setShot(setShot(draft, first.key, 'Gros plan sur la tasse'), second.key, 'Elle sourit');
  return { ...draft, hook: 'Trois secondes pour te convaincre' };
};

describe('the reel sheet’s form (VEI-08)', () => {
  it('counts words as the server does, full at its bound', () => {
    expect(HOOK_COUNTER('Trois secondes pour te convaincre')).toEqual({ label: '5 / 8 mots', full: false });
    expect(HOOK_COUNTER('un deux trois quatre cinq six sept huit').full).toBe(true);
  });

  it('takes no word more than its bound, from a keystroke or a paste', () => {
    expect(typedWords('un deux trois quatre cinq six sept huit n', 8)).toBe(
      'un deux trois quatre cinq six sept huit',
    );
    expect(typedWords('un deux trois quatre cinq six sept huit ', 8)).toBe(
      'un deux trois quatre cinq six sept huit ',
    );
  });

  it('keeps from two to six shots, moved up and down with their keys', () => {
    let draft = filledDraft();
    expect(removeShot(draft, draft.shots[0]?.key ?? 0).shots).toHaveLength(2);
    for (let i = 0; i < 6; i += 1) draft = addShot(draft);
    expect(draft.shots).toHaveLength(6);
    const moved = moveShot(draft, draft.shots[1]?.key ?? 0, -1);
    expect(moved.shots.map((shot) => shot.text).slice(0, 2)).toEqual([
      'Elle sourit',
      'Gros plan sur la tasse',
    ]);
    expect(moveShot(moved, moved.shots[0]?.key ?? 0, -1)).toBe(moved);
  });

  it('steps the duration by 5 within 5 and 90 seconds', () => {
    expect([clampSeconds(2), clampSeconds(22), clampSeconds(200)]).toEqual([5, 20, 90]);
  });

  it('sends nothing for a blank sheet, the sheet once complete, and says what is missing between', () => {
    expect(isBlank(emptyReelDraft())).toBe(true);
    expect(reelBriefOf(emptyReelDraft())).toBeNull();
    expect(reelProblems(emptyReelDraft())).toEqual([]);
    expect(reelProblems({ ...emptyReelDraft(), hook: 'Bonjour toi' })).toEqual(['shots']);
    expect(reelBriefOf(filledDraft())).toEqual({
      hook: 'Trois secondes pour te convaincre',
      onScreen: null,
      shots: ['Gros plan sur la tasse', 'Elle sourit'],
      ending: null,
      seconds: 20,
    });
  });

  it('opens on the sheet it corrects, and previews a draft at each keystroke', () => {
    const brief = reelBriefOf(filledDraft());
    expect(reelBriefOf(reelDraftOf(brief))).toEqual(brief);
    expect(previewOf(emptyReelDraft()).hook).toBe('…');
  });
});
