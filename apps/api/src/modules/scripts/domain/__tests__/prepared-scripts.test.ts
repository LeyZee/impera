import type {
  BranchCondition,
  PersonaLimits,
  PreparedBranch,
  PreparedScriptContent,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  preparedScriptGaps,
  preparedScriptWarnings,
  preparedTransition,
  type PreparedVaultMedia,
} from '../prepared-scripts';

/** Invented keys: a UUID per step and branch, readable in a failure. */
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function branch(n: number, over: Partial<PreparedBranch> = {}): PreparedBranch {
  return {
    key: key(n),
    condition: null,
    teaser: 'Je viens de finir ma journée',
    offerText: 'Un bonsoir sous le plaid',
    media: [{ ref: `m${String(n)}` }],
    afterMedia: { justAfter: '', unread: '', readNotBought: '' },
    priceMinor: 0,
    currency: 'EUR',
    ...over,
  };
}

function script(steps: PreparedBranch[][], over: Partial<PreparedScriptContent> = {}): PreparedScriptContent {
  return {
    name: 'Soirée cocooning',
    description: 'Un soir de pluie, chez elle.',
    moment: 'night',
    steps: steps.map((branches, at) => ({ key: key(900 + at), rhythm: 3, branches })),
    ...over,
  };
}

const described = (refs: string[]): Map<string, PreparedVaultMedia> =>
  new Map(refs.map((ref) => [ref, { kind: 'image', described: true, offered: false }]));

const none: BranchCondition = { kind: 'none' };
const text: BranchCondition = { kind: 'text', text: "S'il a dit aimer les robes" };
const noLimits: PersonaLimits = { never_do: [], never_show: [], never_say: [], disgusts: [] };

describe('what keeps a script in preparation from being ready to copy', () => {
  it('has no gap when every field is written and every media is in her vault, described', () => {
    const content = script([[branch(1)], [branch(2, { priceMinor: 1200 })]]);
    expect(preparedScriptGaps(content, described(['m1', 'm2']), noLimits)).toEqual([]);
    // Played the day and the night alike (« polyvalent »): a moment like the others, no gap of its own.
    expect(preparedScriptGaps({ ...content, moment: 'both' }, described(['m1', 'm2']), noLimits)).toEqual([]);
  });

  it('names the missing name, description, offer text and media, where they are', () => {
    const content = script([[branch(1, { offerText: ' ', media: [] })]], { name: '', description: '' });
    const codes = preparedScriptGaps(content, described([]), noLimits).map((gap) => [gap.code, gap.step]);
    expect(codes).toEqual([
      ['name_missing', null],
      ['description_missing', null],
      ['offer_text_missing', 0],
      ['media_missing', 0],
    ]);
  });

  it('never sells a media offered once: a paid branch with one is a gap, an offered branch is not (ADR 0145 § 2)', () => {
    const vault = new Map<string, PreparedVaultMedia>([
      ['m1', { kind: 'image', described: true, offered: true }],
      ['m2', { kind: 'image', described: true, offered: true }],
    ]);
    const content = script([[branch(1, { priceMinor: 0 })], [branch(2, { priceMinor: 1200 })]]);
    expect(preparedScriptGaps(content, vault, noLimits).map((gap) => [gap.code, gap.step])).toEqual([
      ['media_offered', 1],
    ]);
  });

  it('asks a description for a photo or a video, never for a voice note, and the media to be in her vault', () => {
    const vault = new Map<string, PreparedVaultMedia>([
      ['m1', { kind: 'image', described: false, offered: false }],
      ['m2', { kind: 'audio', described: false, offered: false }],
    ]);
    const content = script([[branch(1)], [branch(2)], [branch(3)]]);
    const gaps = preparedScriptGaps(content, vault, noLimits).map((gap) => [gap.code, gap.step]);
    expect(gaps).toEqual([
      ['media_not_described', 0],
      ['media_absent', 2],
    ]);
  });

  it('asks a condition for each branch of a step that has several, and refuses two defaults', () => {
    const unsettled = script([[branch(1, { condition: none }), branch(2)]]);
    expect(preparedScriptGaps(unsettled, described(['m1', 'm2']), noLimits).map((gap) => gap.code)).toEqual([
      'branch_unsettled',
    ]);
    const twice = script([[branch(1, { condition: none }), branch(2, { condition: none })]]);
    expect(preparedScriptGaps(twice, described(['m1', 'm2']), noLimits).map((gap) => gap.code)).toEqual([
      'branch_two_defaults',
    ]);
  });

  it('refuses the same media on two steps, and a spend condition leading to a cheaper branch', () => {
    const same = script([[branch(1)], [branch(2, { media: [{ ref: 'm1' }] })]]);
    expect(preparedScriptGaps(same, described(['m1']), noLimits).map((gap) => gap.code)).toEqual([
      'media_twice',
    ]);
    const cheaper = script([
      [
        branch(1, { condition: none, priceMinor: 2500 }),
        branch(2, {
          priceMinor: 1500,
          condition: {
            kind: 'structured',
            rule: { kind: 'spent_at_least', amountMinor: 10000, currency: 'EUR' },
          },
        }),
      ],
    ]);
    expect(preparedScriptGaps(cheaper, described(['m1', 'm2']), noLimits).map((gap) => gap.code)).toEqual([
      'branch_cheaper_on_spend',
    ]);
  });

  it('reads a previous-branch condition on the keys of earlier branches', () => {
    const earlier = branch(1);
    const ok = script([
      [earlier],
      [
        branch(2, { condition: none }),
        branch(3, {
          condition: { kind: 'structured', rule: { kind: 'previous_branch', stepRef: earlier.key } },
        }),
      ],
    ]);
    expect(preparedScriptGaps(ok, described(['m1', 'm2', 'm3']), noLimits)).toEqual([]);
    const unknown = script([
      [earlier],
      [
        branch(2, { condition: none }),
        branch(3, { condition: { kind: 'structured', rule: { kind: 'previous_branch', stepRef: key(77) } } }),
      ],
    ]);
    expect(
      preparedScriptGaps(unknown, described(['m1', 'm2', 'm3']), noLimits).map((gap) => gap.code),
    ).toEqual(['branch_previous_unknown']);
  });

  it('names the entry of her persona a text touches, in whole words, once per branch', () => {
    const limits: PersonaLimits = { ...noLimits, never_say: ['bébé'] };
    const content = script([[branch(1, { teaser: 'Coucou bébé', offerText: 'Pour toi bébé' })]]);
    expect(preparedScriptGaps(content, described(['m1']), limits)).toEqual([
      { code: 'disgust', step: 0, branch: key(1), term: 'bébé' },
    ]);
    const word = script([[branch(1, { teaser: 'Les bébés chats' })]]);
    expect(preparedScriptGaps(word, described(['m1']), limits)).toEqual([]);
  });

  it('checks nothing against a persona when she has none active', () => {
    const content = script([[branch(1, { teaser: 'Coucou bébé' })]]);
    expect(preparedScriptGaps(content, described(['m1']), null)).toEqual([]);
  });

  it('asks a text condition to say something', () => {
    const content = script([
      [branch(1, { condition: none }), branch(2, { condition: { kind: 'text', text: '' } })],
    ]);
    expect(preparedScriptGaps(content, described(['m1', 'm2']), noLimits).map((gap) => gap.code)).toContain(
      'condition_text_missing',
    );
    const said = script([[branch(1, { condition: none }), branch(2, { condition: text })]]);
    expect(preparedScriptGaps(said, described(['m1', 'm2']), noLimits)).toEqual([]);
  });
});

describe('the price warnings of a script in preparation', () => {
  it('warns, on the branch, when a paid step is more than twice the paid step before on some path', () => {
    const content = script([
      [branch(1, { priceMinor: 1200 })],
      [branch(2, { condition: none, priceMinor: 2500 }), branch(3, { condition: text, priceMinor: 2000 })],
    ]);
    expect(preparedScriptWarnings(content)).toEqual([
      { code: 'price_more_than_double', step: 1, branch: key(2) },
    ]);
  });

  it('warns on a step with branches and none by default', () => {
    const content = script([[branch(1, { condition: text }), branch(2, { condition: text })]]);
    expect(preparedScriptWarnings(content)).toEqual([
      { code: 'step_without_default', step: 0, branch: null },
    ]);
  });
});

describe('the states of a script in preparation', () => {
  it('becomes ready only without a gap, and goes back to editing on a save', () => {
    expect(preparedTransition('editing', 'ready', 0)).toEqual({ ok: true, next: 'ready_to_copy' });
    expect(preparedTransition('editing', 'ready', 2)).toEqual({ ok: false, reason: 'gaps' });
    expect(preparedTransition('ready_to_copy', 'save', 0)).toEqual({ ok: true, next: 'editing' });
    expect(preparedTransition('ready_to_copy', 'editing', 0)).toEqual({ ok: true, next: 'editing' });
  });

  it('never changes once an import recognised it', () => {
    expect(preparedTransition('matched', 'save', 0)).toEqual({ ok: false, reason: 'closed' });
    expect(preparedTransition('matched', 'ready', 0)).toEqual({ ok: false, reason: 'closed' });
  });
});
