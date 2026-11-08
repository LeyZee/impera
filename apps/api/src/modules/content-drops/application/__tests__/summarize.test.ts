import type { ScriptDropSummary, ScriptSegment } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { ScriptSummaryFailed } from '../../domain/errors';
import type {
  ScriptSummarizer,
  ScriptSummaryStore,
  ScriptToSummarize,
  SummarizedScript,
} from '../../domain/ports';
import { summarizeScript } from '../summarize';

const NOW = new Date('2026-11-08T18:00:00.000Z');

/** Invented: a stage with a photo and a voice note, a stage with a video. */
const segments: ScriptSegment[] = [
  {
    kind: 'stage',
    key: 'salon',
    name: 'Le salon',
    intention: 'Elle se dévoile un peu',
    access: 'free',
    mood: null,
    outfit: 'Robe noire',
    place: null,
    mediaSlots: [
      { kind: 'image', optional: false, hint: null },
      { kind: 'audio', optional: true, hint: null, maxSeconds: 30 },
    ],
    variants: [],
  },
  {
    kind: 'stage',
    key: 'chambre',
    name: 'La chambre',
    intention: 'Elle se dévoile plus',
    access: 'paid',
    mood: null,
    outfit: null,
    place: 'Le lit',
    mediaSlots: [{ kind: 'video', optional: false, hint: null, minSeconds: 5, maxSeconds: 60 }],
    variants: [],
  },
];

const told = (step: string, summary = `Résumé de ${step}.`) => ({
  step,
  overview: `Ce que montre ${step}.`,
  summary,
});
const SUMMARY: ScriptDropSummary = {
  shootingContext: 'Un soir chez elle, du salon à la chambre.',
  steps: [told('salon:'), told('chambre:')],
};

const TARGET: ScriptToSummarize = {
  creatorId: 'creator',
  describes: true,
  versionId: 'version',
  moment: 'night',
  files: [
    { slotKey: 'chambre::0', mediaAssetId: 'm3', kind: 'video', durationS: 42.4 },
    { slotKey: 'salon::0', mediaAssetId: 'm1', kind: 'image', durationS: null },
    { slotKey: 'salon::1', mediaAssetId: 'm2', kind: 'audio', durationS: 12 },
  ],
};

function fakes(
  options: {
    readonly target?: ScriptToSummarize | null;
    readonly summarized?: boolean;
    readonly described?: readonly string[];
    /** The row each description comes from, by medium: a correction is a new row. */
    readonly rows?: Readonly<Record<string, string>>;
    readonly answers?: readonly Awaited<ReturnType<ScriptSummarizer['summarize']>>[];
  } = {},
) {
  const saved: SummarizedScript[] = [];
  const later: Date[] = [];
  const asked: Parameters<ScriptSummarizer['summarize']>[0][] = [];
  const target = options.target === undefined ? TARGET : options.target;
  const asks: string[] = [];
  const store: ScriptSummaryStore = {
    target: () => Promise.resolve(target),
    summarized: (_dropId, mediaHash, promptHash) => {
      asks.push(`${mediaHash}@${promptHash}`);
      return Promise.resolve(options.summarized ?? false);
    },
    save: (_creatorId, _dropId, summary) => {
      saved.push(summary);
      return Promise.resolve();
    },
    later: (_creatorId, _dropId, _correlationId, runAt) => {
      later.push(runAt);
      return Promise.resolve();
    },
    enqueueFor: () => Promise.reject(new Error('not used')),
  };
  const described = options.described ?? ['m1', 'm3'];
  let answer = 0;
  const deps = {
    store,
    describer: {
      detailed: (ids: readonly string[]) =>
        Promise.resolve(
          new Map(
            ids
              .filter((id) => described.includes(id))
              .map((id) => [
                id,
                { descriptionId: options.rows?.[id] ?? `d-${id}`, detailed: `Description de ${id}.` },
              ]),
          ),
        ),
    },
    summarizer: {
      promptHash: 'summary-v1',
      summarize: (input: Parameters<ScriptSummarizer['summarize']>[0]) => {
        asked.push(input);
        const answers = options.answers ?? [
          { kind: 'summarized', summary: SUMMARY, model: 'grok-4.7', promptHash: 'hash' },
        ];
        const next = answers[Math.min(answer, answers.length - 1)];
        answer += 1;
        if (next === undefined) throw new Error('no answer');
        return Promise.resolve(next);
      },
    },
    versions: {
      frozen: () => Promise.resolve({ name: 'Soirée salon', moment: 'both' as const, segments }),
    },
  };
  return { deps, saved, later, asked, asks };
}

describe('content-drops › content_drops.summarize_script (ADR 0083 § 6)', () => {
  it('tells each step from its card and its media’s descriptions, then keeps the synthesis', async () => {
    const { deps, saved, asked } = fakes();

    expect(await summarizeScript(deps, 'drop', NOW, 'corr')).toBe('summarized');

    expect(asked).toEqual([
      {
        creatorId: 'creator',
        scriptName: 'Soirée salon',
        moment: 'night',
        steps: [
          {
            step: 'salon:',
            code: 'E1',
            name: 'Le salon',
            card: 'Elle se dévoile un peu. Tenue : Robe noire.',
            media: [
              { kind: 'image', durationS: null, description: 'Description de m1.' },
              { kind: 'audio', durationS: 12, description: null },
            ],
          },
          {
            step: 'chambre:',
            code: 'E2',
            name: 'La chambre',
            card: 'Elle se dévoile plus. Lieu : Le lit.',
            media: [{ kind: 'video', durationS: 42.4, description: 'Description de m3.' }],
          },
        ],
      },
    ]);
    expect(saved[0]?.mediaHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(saved).toEqual([
      {
        mediaHash: saved[0]?.mediaHash,
        content: SUMMARY,
        reviewReasons: [],
        model: 'grok-4.7',
        promptHash: 'hash',
      },
    ]);
  });

  it('gives the same set of media the same hash, whatever the order the files come in', async () => {
    const first = fakes();
    const second = fakes({
      target: {
        ...TARGET,
        moment: null,
        files: [
          { slotKey: 'salon::1', mediaAssetId: 'm2', kind: 'audio', durationS: 12 },
          { slotKey: 'salon::0', mediaAssetId: 'm1', kind: 'image', durationS: null },
          { slotKey: 'chambre::0', mediaAssetId: 'm3', kind: 'video', durationS: 42.4 },
        ],
      },
    });
    await summarizeScript(first.deps, 'drop', NOW, 'corr');
    await summarizeScript(second.deps, 'drop', NOW, 'corr');

    expect(second.saved[0]?.mediaHash).toBe(first.saved[0]?.mediaHash);
    // `both` and no moment fixed by her request: none is said.
    expect(second.asked[0]?.moment).toBeNull();
  });

  it('tells the script again once a description is corrected, with the prompt of now', async () => {
    const first = fakes();
    const corrected = fakes({ rows: { m3: 'd-m3-human' } });
    await summarizeScript(first.deps, 'drop', NOW, 'corr');
    await summarizeScript(corrected.deps, 'drop', NOW, 'corr');

    expect(corrected.saved[0]?.mediaHash).not.toBe(first.saved[0]?.mediaHash);
    expect(first.asks[0]).toMatch(/@summary-v1$/u);
  });

  it('waits while a file is in the cleaning or a photo or video is not described yet', async () => {
    const cleaning = fakes({
      target: {
        ...TARGET,
        files: [{ slotKey: 'salon::0', mediaAssetId: null, kind: 'image', durationS: null }],
      },
    });
    expect(await summarizeScript(cleaning.deps, 'drop', NOW, 'corr')).toBe('waiting');

    const undescribed = fakes({ described: ['m1'] });
    expect(await summarizeScript(undescribed.deps, 'drop', NOW, 'corr')).toBe('waiting');
    expect(undescribed.asked).toEqual([]);
  });

  it('does nothing while her switch is off, for a set already told, or a drop gone', async () => {
    const off = fakes({ target: { ...TARGET, describes: false } });
    expect(await summarizeScript(off.deps, 'drop', NOW, 'corr')).toBe('off');
    const already = fakes({ summarized: true });
    expect(await summarizeScript(already.deps, 'drop', NOW, 'corr')).toBe('already');
    const gone = fakes({ target: null });
    expect(await summarizeScript(gone.deps, 'drop', NOW, 'corr')).toBe('gone');
    expect([...off.asked, ...already.asked, ...gone.asked]).toEqual([]);
  });

  it('asks again an hour later when the day’s budget is spent', async () => {
    const { deps, saved, later } = fakes({ answers: [{ kind: 'budget' }] });

    expect(await summarizeScript(deps, 'drop', NOW, 'corr')).toBe('later');

    expect(later).toEqual([new Date('2026-11-08T19:00:00.000Z')]);
    expect(saved).toEqual([]);
  });

  it('fails, to be retried, when every model fails or the steps told are not the script’s', async () => {
    await expect(
      summarizeScript(fakes({ answers: [{ kind: 'failed' }] }).deps, 'drop', NOW, 'corr'),
    ).rejects.toThrow(ScriptSummaryFailed);
    const other = { ...SUMMARY, steps: [told('salon:'), told('cuisine:')] };
    const wrong = fakes({ answers: [{ kind: 'summarized', summary: other, model: 'm', promptHash: 'h' }] });
    await expect(summarizeScript(wrong.deps, 'drop', NOW, 'corr')).rejects.toThrow(ScriptSummaryFailed);
    expect(wrong.saved).toEqual([]);
  });

  it('asks once more for a synthesis that names a price, then keeps it with its reason', async () => {
    const priced = { ...SUMMARY, steps: [told('salon:'), told('chambre:', 'La vidéo à 25 €.')] };
    const fixed = fakes({
      answers: [
        { kind: 'summarized', summary: priced, model: 'm', promptHash: 'h' },
        { kind: 'summarized', summary: SUMMARY, model: 'm', promptHash: 'h' },
      ],
    });
    expect(await summarizeScript(fixed.deps, 'drop', NOW, 'corr')).toBe('summarized');
    expect(fixed.saved.map((one) => one.reviewReasons)).toEqual([[]]);

    const stubborn = fakes({
      answers: [{ kind: 'summarized', summary: priced, model: 'm', promptHash: 'h' }],
    });
    await summarizeScript(stubborn.deps, 'drop', NOW, 'corr');
    expect(stubborn.asked).toHaveLength(2);
    expect(stubborn.saved.map((one) => one.reviewReasons)).toEqual([['price']]);

    const spent = fakes({
      answers: [{ kind: 'summarized', summary: priced, model: 'm', promptHash: 'h' }, { kind: 'budget' }],
    });
    await summarizeScript(spent.deps, 'drop', NOW, 'corr');
    expect(spent.saved.map((one) => one.reviewReasons)).toEqual([['price']]);
  });
});
