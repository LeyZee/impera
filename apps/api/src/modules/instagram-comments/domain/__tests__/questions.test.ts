import { describe, expect, it } from 'vitest';

import { asksAQuestion, boundedQuestionEvery, mayAskQuestion, QUESTION_EVERY_BOUNDS } from '../questions';

describe('her questions in public, one reply in a few at most (Charles, 26/11)', () => {
  it('lets her first reply of the day ask, then one in three', () => {
    const asked: boolean[] = [];
    let questions = 0;
    for (let replies = 0; replies < 9; replies += 1) {
      const may = mayAskQuestion({ replies, questions }, 3);
      asked.push(may);
      if (may) questions += 1;
    }
    expect(asked).toEqual([true, false, false, true, false, false, true, false, false]);
  });

  it('keeps the setting inside the code’s bounds', () => {
    expect(boundedQuestionEvery(1)).toBe(QUESTION_EVERY_BOUNDS.min);
    expect(boundedQuestionEvery(50)).toBe(QUESTION_EVERY_BOUNDS.max);
    expect(boundedQuestionEvery(Number.NaN)).toBe(QUESTION_EVERY_BOUNDS.default);
    expect(mayAskQuestion({ replies: 1, questions: 1 }, 1)).toBe(false);
  });

  it('reads a question by its mark, full-width forms folded', () => {
    expect(asksAQuestion('Vraiment ?')).toBe(true);
    expect(asksAQuestion('Vraiment？')).toBe(true);
    expect(asksAQuestion('Merci 🫶🏻')).toBe(false);
  });
});
