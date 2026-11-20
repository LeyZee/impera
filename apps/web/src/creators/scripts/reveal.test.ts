import { describe, expect, it } from 'vitest';

import { batchOf, mediaToValidate, placeOf, priceLine, revealStanding, revealSummary } from './reveal';
import { descriptionId, identityOf, mediaOf, revealScriptOf, stepOf } from './reveal-fixtures';

const shown = (n: number, reviewReasons: ('unsure' | 'flagged')[] = [], validated = false) => ({
  id: descriptionId(n),
  detailed: `Description inventée ${String(n)}.`,
  reviewReasons,
  validated,
});

describe('« Ses scripts dans Reveal »: what keeps each one from being offered', () => {
  it('says the next gesture, in the order it is undone', () => {
    const base = { proposable: false };
    expect(revealStanding(revealScriptOf(1, { ...base, gaps: ['step_discounted'] }))).toMatchObject({
      tone: 'warn',
      opens: null,
    });
    const absent = revealScriptOf(2, {
      ...base,
      gaps: ['media_absent', 'media_not_described', 'identity_not_validated'],
      steps: [stepOf(0, 0, [mediaOf('m1', null, { inVault: false, imported: false })])],
    });
    expect(revealStanding(absent).line).toBe('1 média absent du coffre : synchronise-le.');
    const out = revealScriptOf(3, {
      ...base,
      gaps: ['media_not_imported', 'media_not_described', 'identity_not_validated'],
      steps: [
        stepOf(0, 0, [mediaOf('m1', null, { imported: false }), mediaOf('m2', null, { imported: false })]),
      ],
    });
    expect(revealStanding(out)).toMatchObject({
      tone: 'todo',
      line: '2 médias à importer : coche son dossier dans le coffre.',
    });
    const toRead = revealScriptOf(4, {
      ...base,
      gaps: ['media_not_described', 'identity_not_validated'],
      steps: [stepOf(0, 0, [mediaOf('m1', shown(1)), mediaOf('m2', null)])],
    });
    expect(revealStanding(toRead)).toMatchObject({ line: '1 description à valider.', opens: 'descriptions' });
    const bare = revealScriptOf(5, {
      ...base,
      gaps: ['media_not_described', 'identity_not_validated'],
      steps: [stepOf(0, 0, [mediaOf('m1', null), mediaOf('v', null, { kind: 'audio' })])],
    });
    expect(revealStanding(bare)).toMatchObject({
      tone: 'wait',
      line: '1 média à décrire : « Décrire par IA » dans le coffre.',
    });
    const writing = revealScriptOf(6, { ...base, gaps: ['identity_not_validated'] });
    expect(revealStanding(writing)).toMatchObject({ tone: 'wait', line: 'L’IA écrit son identité.' });
    const identity = revealScriptOf(7, {
      ...base,
      gaps: ['identity_not_validated'],
      identity: identityOf(null),
    });
    expect(revealStanding(identity)).toMatchObject({ tone: 'todo', opens: 'identity' });
    expect(
      revealStanding(revealScriptOf(8, { identity: identityOf('2026-11-20T01:00:00.000Z') })),
    ).toMatchObject({
      tone: 'ok',
      label: 'Prêt',
    });
  });

  it('lists each description to read once, in order, and « Valider les … » leaves a doubted one alone', () => {
    const script = revealScriptOf(1, {
      steps: [
        stepOf(0, 0, [mediaOf('m1', shown(1)), mediaOf('m2', shown(2, [], true))]),
        {
          ...stepOf(1, 1_200, [mediaOf('m3', shown(3, ['unsure']))]),
          previewMedia: [mediaOf('m1', shown(1))],
        },
      ],
    });
    const media = mediaToValidate(script);
    expect(media.map((each) => [each.ref, each.step])).toEqual([
      ['m1', 1],
      ['m3', 2],
    ]);
    expect(batchOf(media)).toEqual([descriptionId(1)]);
    // Two media in the first step: each says which; one alone in its step says only its kind.
    expect(media.map(placeOf)).toEqual(['Étape 1 · Photo 1 sur 2', 'Étape 2 · Photo 1 sur 2']);
    expect(priceLine(script)).toBe('2 étapes · Offert · 12 €');
  });

  it('counts her active scripts ready to offer', () => {
    expect(revealSummary([])).toBe('Aucun de nos scripts recopié dans Reveal');
    expect(
      revealSummary([
        revealScriptOf(1),
        revealScriptOf(2, {
          proposable: false,
          gaps: ['identity_not_validated'],
          identity: identityOf(null),
        }),
        revealScriptOf(3, { active: false, proposable: false }),
      ]),
    ).toBe('1 prêt à proposer sur 2 · 1 à valider ou importer');
  });
});
