import type { PreparedBranch, PreparedScriptContent } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  copyDifferences,
  matchPrepared,
  recognise,
  transferredSettings,
  type NativeBranch,
  type NativeScriptForMatch,
} from '../recognition';

/** Invented keys and refs only. */
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function branch(n: number, over: Partial<PreparedBranch> = {}): PreparedBranch {
  return {
    key: key(n),
    condition: null,
    teaser: '',
    offerText: 'Texte inventé',
    media: [{ ref: `m${String(n)}` }],
    afterMedia: { justAfter: '', unread: '', readNotBought: '' },
    priceMinor: 1000 * n,
    currency: 'EUR',
    ...over,
  };
}

function prepared(steps: PreparedBranch[][], name = 'Soirée inventée'): PreparedScriptContent {
  return {
    name,
    description: 'Inventée.',
    moment: 'night',
    steps: steps.map((branches, at) => ({ key: key(900 + at), rhythm: 3, branches })),
  };
}

const native = (n: number, rank: number, over: Partial<NativeBranch> = {}): NativeBranch => ({
  ref: `step_${String(n)}`,
  platformIndex: rank,
  priceMinor: 1000 * n,
  currency: 'EUR',
  soldMediaRefs: [`m${String(n)}`],
  ...over,
});

const script = (
  branches: NativeBranch[],
  name = 'Soirée inventée',
  id = 'native-1',
): NativeScriptForMatch => ({
  id,
  name,
  branches,
});

describe('the recognition of a script copied into Reveal', () => {
  it('ties each branch to the native branch of its rank selling the same media at the same price', () => {
    const content = prepared([[branch(1)], [branch(2), branch(3)]]);
    // Reveal lists the branches of a rank in no stable order.
    const outcome = matchPrepared(content, script([native(1, 0), native(3, 5), native(2, 5)]));
    expect(outcome).toEqual({
      matched: true,
      refs: new Map([
        [key(1), 'step_1'],
        [key(2), 'step_2'],
        [key(3), 'step_3'],
      ]),
    });
  });

  it('says what differs: the name, the number of steps, of branches, a branch with other media or price', () => {
    const content = prepared([[branch(1)], [branch(2), branch(3)]]);
    expect(matchPrepared(content, script([native(1, 0)], 'Autre'))).toEqual({
      matched: false,
      differences: [{ code: 'name_not_found' }],
    });
    expect(matchPrepared(content, script([native(1, 0)]))).toMatchObject({
      differences: [{ code: 'steps_count', expected: 2, found: 1 }],
    });
    expect(matchPrepared(content, script([native(1, 0), native(2, 1)]))).toMatchObject({
      differences: [{ code: 'branches_count', step: 1, expected: 2, found: 1 }],
    });
    expect(
      matchPrepared(content, script([native(1, 0, { priceMinor: 999 }), native(2, 1), native(3, 1)])),
    ).toMatchObject({ differences: [{ code: 'branch_not_found', step: 0, branch: key(1) }] });
    expect(
      matchPrepared(content, script([native(1, 0), native(2, 1, { soldMediaRefs: ['m9'] }), native(3, 1)])),
    ).toMatchObject({ differences: [{ code: 'branch_not_found', step: 1, branch: key(2) }] });
  });

  it('passes the order and conditions of a step of several branches, a previous branch by its stepRef', () => {
    const content = prepared([
      [branch(1)],
      [
        branch(2, { condition: { kind: 'none' } }),
        branch(3, { condition: { kind: 'structured', rule: { kind: 'previous_branch', stepRef: key(1) } } }),
      ],
    ]);
    const outcome = matchPrepared(content, script([native(1, 0), native(2, 1), native(3, 1)]));
    if (!outcome.matched) throw new Error('not matched');
    expect(transferredSettings(content, outcome.refs)).toEqual([
      { stepRef: 'step_2', order: 0, condition: { kind: 'none' } },
      {
        stepRef: 'step_3',
        order: 1,
        condition: { kind: 'structured', rule: { kind: 'previous_branch', stepRef: 'step_1' } },
      },
    ]);
  });

  it('ties a native script once, the oldest script ready to copy first', () => {
    const content = prepared([[branch(1)]]);
    const natives = [script([native(1, 0)], 'Soirée inventée', 'native-1')];
    expect(
      recognise(
        [
          { id: 'older', content },
          { id: 'newer', content },
        ],
        natives,
      ),
    ).toEqual([{ preparedId: 'older', nativeId: 'native-1', settings: [] }]);
  });

  it('shows the differences against the closest native script of the same name', () => {
    const content = prepared([[branch(1)], [branch(2)]]);
    expect(copyDifferences(content, [])).toEqual([{ code: 'name_not_found' }]);
    expect(copyDifferences(content, [script([native(1, 0), native(2, 1, { priceMinor: 1 })])])).toEqual([
      { code: 'branch_not_found', step: 1, branch: key(2) },
    ]);
    expect(copyDifferences(content, [script([native(1, 0), native(2, 1)])])).toEqual([]);
  });
});
