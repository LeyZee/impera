import { CREATOR_SETUP_STEPS, CreatorIdSchema, MEMBER_SETUP_STEPS } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorLines, memberLines, nextOf, progressOf } from './model';

const ANNA = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');

describe('« Mise en route » words', () => {
  it('names every creator step and says where it is done', () => {
    const lines = creatorLines(
      ANNA,
      CREATOR_SETUP_STEPS.map((key) => ({ key, state: 'todo' as const, note: null })),
    );
    expect(lines.every((line) => line.label.length > 0 && line.target !== null)).toBe(true);
    expect(lines.find((line) => line.key === 'persona')?.target).toEqual({
      kind: 'sheet',
      sheet: 'persona',
      creatorId: ANNA,
    });
    expect(lines.find((line) => line.key === 'agent_mode')?.target).toEqual({
      kind: 'dashboard',
      creatorId: ANNA,
    });
  });

  it('says the mode in force, and Telegram off', () => {
    const [mode, telegram] = creatorLines(ANNA, [
      { key: 'agent_mode', state: 'done', note: { kind: 'agent_mode', mode: 'copilot' } },
      { key: 'telegram', state: 'todo', note: { kind: 'telegram_off' } },
    ]);
    expect(mode?.hint).toBe('Copilote');
    expect(telegram?.hint).toBe('Telegram n’est pas branché : personne n’est prévenu la nuit.');
  });

  it('names every member step', () => {
    const lines = memberLines(MEMBER_SETUP_STEPS.map((key) => ({ key, state: 'done' as const, note: null })));
    expect(lines.map((line) => line.hint)).toEqual([null, null, null, null, null, null]);
    expect(progressOf(lines)).toEqual({ done: 6, total: 6 });
    expect(nextOf(lines)).toBeUndefined();
  });

  it('puts a step to do before one that waits on someone else', () => {
    const lines = memberLines([
      { key: 'invitation', state: 'waiting', note: null },
      { key: 'creators', state: 'todo', note: null },
    ]);
    expect(nextOf(lines)?.key).toBe('creators');
  });
});
