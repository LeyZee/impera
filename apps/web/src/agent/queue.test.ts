import type { CreatorTodo, DashboardTodo } from '@impera/contracts';
import { ConversationIdSchema, CreatorIdSchema, FanIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { queueEntries } from './queue';

let n = 0;
function todo(
  kind: DashboardTodo['kind'],
  waitingMinutes: number,
  patch: Partial<CreatorTodo> = {},
): CreatorTodo {
  n += 1;
  const tail = String(n).padStart(3, '0');
  return {
    id: `${kind}-${tail}`,
    tone: kind === 'minor' || kind === 'distress' || kind === 'non_consent' ? 'bad' : 'warn',
    kind,
    title: `Fan ${tail}`,
    why: `Pourquoi ${kind}`,
    at: new Date(Date.UTC(2026, 10, 6, 18, 0) - waitingMinutes * 60_000).toISOString(),
    waitingMinutes,
    conversationId: ConversationIdSchema.parse(`0192f3a0-0000-7000-8000-000000000${tail}`),
    fanId: FanIdSchema.parse(`0192f3a0-0000-7000-8001-000000000${tail}`),
    creatorId: CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1'),
    creatorName: 'Léa',
    ...patch,
  };
}

const LINA = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c2');

describe('« À traiter » on the screen (recette AGT-05)', () => {
  it('says one failure of the agent once, after the grave lines and what a person can act on', () => {
    const down = Array.from({ length: 20 }, (_, i) => todo('llm_unavailable', 60 - i));
    const draft = todo('awaiting_approval', 2);
    const minor = todo('minor', 1);
    const budget = todo('budget', 90);
    // The route's order does not count: the screen sorts itself.
    const entries = queueEntries([...down, budget, draft, minor]);
    expect(
      entries.map((e) => (e.kind === 'one' ? e.todo.kind : `${e.cause} × ${String(e.todos.length)}`)),
    ).toEqual(['minor', 'awaiting_approval', 'budget', 'llm_unavailable × 20']);
    const group = entries[3];
    if (group?.kind !== 'group') throw new Error('a group');
    expect(group.oldest.waitingMinutes).toBe(60);
    expect(group.latest.waitingMinutes).toBe(41);
  });

  it('keeps one line alone, and groups a missing persona per creator', () => {
    const entries = queueEntries([
      todo('persona_inactive', 10),
      todo('persona_inactive', 9),
      todo('persona_inactive', 30, { creatorId: LINA, creatorName: 'Lina' }),
      todo('llm_unavailable', 5),
    ]);
    expect(
      entries.map((e) => (e.kind === 'one' ? e.todo.kind : `${e.cause} × ${String(e.todos.length)}`)),
    ).toEqual(['persona_inactive', 'persona_inactive × 2', 'llm_unavailable']);
  });

  it('orders the grave lines and the others by the longest wait', () => {
    const entries = queueEntries([
      todo('unanswered', 5),
      todo('distress', 3),
      todo('minor', 8),
      todo('keyword', 40),
    ]);
    expect(
      entries.map((e) => (e.kind === 'one' ? `${e.todo.kind} ${String(e.todo.waitingMinutes)}` : '')),
    ).toEqual(['minor 8', 'distress 3', 'keyword 40', 'unanswered 5']);
  });
});
