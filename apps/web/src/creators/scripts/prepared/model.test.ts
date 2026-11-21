import { describe, expect, it } from 'vitest';

import { ACCOUNT, CHOICES, CONTENT, VAULT, branchOf } from './fixtures';
import { editorMedia, pickerFolders, startFolder } from './media';
import {
  conditionLabel,
  differenceText,
  gapText,
  momentLabel,
  parsePrice,
  priceLabel,
  scriptPaths,
  withBranchAdded,
  withStepMoved,
  withoutBranch,
  withoutStep,
} from './model';

describe('the editor of a script in preparation, pure (SCB-04 lot 3)', () => {
  it('reads a price as typed, in minor units, and says it as a fan reads it', () => {
    expect(parsePrice('12')).toBe(1200);
    expect(parsePrice('12,5')).toBe(1250);
    expect(parsePrice(' 9.90 € ')).toBe(990);
    expect(parsePrice('')).toBe(0);
    expect(parsePrice('douze')).toBeNull();
    expect(parsePrice('1,234')).toBeNull();
    expect(priceLabel(0)).toBe('Offert');
    expect(priceLabel(1200)).toBe('12 €');
    expect(priceLabel(1250)).toBe('12,50 €');
  });

  it('says when a script is played, the day, the night or both', () => {
    expect([momentLabel('day'), momentLabel('night'), momentLabel('both')]).toEqual([
      'Jour',
      'Nuit',
      'Jour et nuit',
    ]);
  });

  it('names each path after the branches it takes that are not defaults, defaults first', () => {
    const paths = scriptPaths(CONTENT);
    expect(paths.count).toBe(2);
    expect(paths.shown.map((path) => [path.name, path.prices, path.totalMinor])).toEqual([
      ['Par défaut', [0, 1200], 1200],
      ['S’il aime le rouge', [0, 1500], 1500],
    ]);
  });

  it('names a path through a branch still to set by its place, never « Par défaut » (PRO1-07)', () => {
    const [first, second] = CONTENT.steps;
    if (first === undefined || second === undefined) throw new Error('fixture');
    const unset = {
      ...CONTENT,
      steps: [
        first,
        { ...second, branches: [...second.branches, branchOf(30, { condition: null, priceMinor: 900 })] },
      ],
    };
    const names = scriptPaths(unset).shown.map((path) => path.name);
    expect(names.filter((name) => name === 'Par défaut')).toHaveLength(1);
    expect(names).toContain('Branche 3 à l’étape 2, à régler');
  });

  it('counts the paths without building more than it shows', () => {
    const wide = {
      ...CONTENT,
      steps: Array.from({ length: 10 }, (_, at) => ({
        key: crypto.randomUUID(),
        rhythm: 0,
        branches: [1, 2, 3, 4].map((n) => branchOf(at * 10 + n)),
      })),
    };
    const paths = scriptPaths(wide);
    expect(paths.count).toBe(4 ** 10);
    expect(paths.shown).toHaveLength(8);
  });

  it('never counts a path a fan cannot take, and names a following branch by what it says', () => {
    const [first, second] = CONTENT.steps;
    if (first === undefined || second === undefined) throw new Error('fixture');
    const special = second.branches[1];
    if (special === undefined) throw new Error('fixture');
    const followers = {
      ...CONTENT,
      steps: [
        first,
        second,
        {
          key: crypto.randomUUID(),
          rhythm: 2,
          branches: [
            branchOf(20, { condition: { kind: 'none' }, priceMinor: 2000 }),
            branchOf(21, {
              condition: { kind: 'structured', rule: { kind: 'previous_branch', stepRef: special.key } },
              priceMinor: 4000,
            }),
          ],
        },
      ],
    };
    const paths = scriptPaths(followers);
    expect(paths.count).toBe(2);
    expect(paths.shown.map((path) => [path.name, path.totalMinor])).toEqual([
      ['Par défaut', 3200],
      ['S’il aime le rouge, puis « Un texte d’offre inventé »', 5500],
    ]);
    const said = scriptPaths({
      ...followers,
      steps: followers.steps.map((step, at) =>
        at === 2
          ? { ...step, branches: step.branches.map((b) => ({ ...b, teaser: 'La version longue' })) }
          : step,
      ),
    });
    expect(said.shown.at(-1)?.name).toBe('S’il aime le rouge, puis « La version longue »');
  });

  it('says each gap where it is, and a limit as she wrote it', () => {
    const second = CONTENT.steps[1]?.branches[1]?.key ?? null;
    expect(gapText(CONTENT, { code: 'name_missing', step: null, branch: null, term: null })).toBe(
      'Le script : il lui faut un nom',
    );
    expect(gapText(CONTENT, { code: 'media_missing', step: 1, branch: second, term: null })).toBe(
      'Étape 2, branche 2 : aucun média',
    );
    expect(gapText(CONTENT, { code: 'disgust', step: 0, branch: null, term: 'un mot inventé' })).toBe(
      'Étape 1 : un texte touche « un mot inventé »',
    );
  });

  it('says what still differs from Reveal', () => {
    expect(differenceText(CONTENT, { code: 'name_not_found' })).toBe(
      'Aucun script de ce nom dans Reveal pour l’instant',
    );
    expect(differenceText(CONTENT, { code: 'steps_count', expected: 2, found: 1 })).toBe(
      'Reveal a 1 étape, il en faut 2',
    );
  });

  it('turns the only branch of a step into the default when a second one comes', () => {
    const added = withBranchAdded(CONTENT, 0);
    expect(added.steps[0]?.branches.map((branch) => branch.condition)).toEqual([{ kind: 'none' }, null]);
  });

  it('unsets the conditions that followed a branch removed, and the last one left needs none', () => {
    const followed = CONTENT.steps[1]?.branches[0]?.key ?? '';
    const withThird = {
      ...CONTENT,
      steps: [
        ...CONTENT.steps,
        {
          key: crypto.randomUUID(),
          rhythm: 0,
          branches: [
            branchOf(7, {
              condition: { kind: 'structured', rule: { kind: 'previous_branch', stepRef: followed } },
            }),
          ],
        },
      ],
    };
    expect(conditionLabel(withThird.steps[2]?.branches[0]?.condition ?? null, withThird).text).toBe(
      'A pris la branche 1 à l’étape 2',
    );
    const removed = withoutBranch(withThird, followed);
    expect(removed.steps[1]?.branches).toHaveLength(1);
    expect(removed.steps[1]?.branches[0]?.condition).toBeNull();
    expect(removed.steps[2]?.branches[0]?.condition).toBeNull();
    expect(withoutStep(withThird, 1).steps[1]?.branches[0]?.condition).toBeNull();
  });

  it('moves a step by one place, never past an end', () => {
    expect(withStepMoved(CONTENT, 0, 1).steps.map((step) => step.key)).toEqual(
      [...CONTENT.steps].reverse().map((step) => step.key),
    );
    expect(withStepMoved(CONTENT, 0, -1)).toBe(CONTENT);
  });
});

describe('the media picker’s first folder (PRO1-11)', () => {
  const [night] = VAULT.folders;
  if (night === undefined) throw new Error('fixture');
  // A Day folder first, not in Impera, then the Night one, imported.
  const day = { ...night, folderRef: 'f0', folderName: 'Café inventé ☀️', moment: 'day' as const };
  const vault = { ...VAULT, folders: [day, night] };

  it('opens on the first folder in Impera of the script’s moment, else the first in Impera, else the first', () => {
    const folders = pickerFolders(vault);
    const media = editorMedia(vault, CHOICES);
    expect(folders.map((folder) => folder.name)).toEqual(['Café inventé ☀️', 'Dossier inventé']);
    expect(startFolder(folders, media, 'night')).toBe(`${ACCOUNT}:f1`);
    expect(startFolder(folders, media, 'day')).toBe(`${ACCOUNT}:f1`);
    expect(startFolder(folders, editorMedia(vault, undefined), 'night')).toBe(`${ACCOUNT}:f0`);
    expect(startFolder([], media, 'both')).toBe('');
  });
});
