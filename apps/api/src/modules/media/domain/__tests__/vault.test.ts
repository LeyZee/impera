import { describe, expect, it } from 'vitest';

import { isMpegTs, vaultDescribeOrder, type VaultCandidate, type VaultScript } from '../vault';

/** An invented vault media (ADR 0010): a photo of the folder `f2` uploaded on 1 March, first of its second. */
const media = (id: string, over: Partial<VaultCandidate> = {}): VaultCandidate => ({
  refId: `ref_${id}`,
  platformMediaId: id,
  kind: 'image',
  folderRef: 'f2',
  folderName: 'SCRIPT 2',
  platformCreatedAt: '2027-03-01T10:00:00.000Z',
  folderPosition: 0,
  ...over,
});

const script = (scriptId: string, active: boolean, platformMediaIds: string[]): VaultScript => ({
  scriptId,
  active,
  platformMediaIds,
});

const ids = (order: readonly VaultCandidate[]): string[] =>
  order.map((candidate) => candidate.platformMediaId);

describe('vaultDescribeOrder (ADR 0113 § 5)', () => {
  it('takes the folders in the vault’s own order when no script holds a media, by number, the root last', () => {
    const order = vaultDescribeOrder(
      [
        media('root', { folderRef: null, folderName: null }),
        media('ten', { folderRef: 'f10', folderName: 'SCRIPT 10' }),
        media('two_old', { platformCreatedAt: '2027-02-01T10:00:00.000Z' }),
        media('two_new'),
        media('two_new_second', { folderPosition: 1 }),
      ],
      [],
    );
    expect(ids(order)).toEqual(['two_new', 'two_new_second', 'two_old', 'ten', 'root']);
  });

  it('describes the active scripts first, the one missing the fewest descriptions first, then the inactive ones', () => {
    const order = vaultDescribeOrder(
      [media('a1'), media('a2'), media('a3'), media('b1'), media('c1'), media('loose')],
      [
        script('script_a', true, ['a1', 'a2', 'a3']),
        script('script_b', true, ['b1', 'described_already']),
        script('script_c', false, ['c1']),
      ],
    );
    // b misses one description (its other media is described), a three; c is inactive, the loose one last.
    expect(ids(order)).toEqual(['b1', 'a1', 'a2', 'a3', 'c1', 'loose']);
  });

  it('keeps a script’s own order, its previews included, and gives a shared media its best place', () => {
    const order = vaultDescribeOrder(
      [media('step2'), media('teaser'), media('step1'), media('shared')],
      [
        script('long', true, ['step1', 'teaser', 'step2', 'shared']),
        script('short', true, ['shared']),
        script('old', false, ['step1']),
      ],
    );
    expect(ids(order)).toEqual(['shared', 'step1', 'teaser', 'step2']);
  });

  it('counts a media listed twice in a script once, and ties by the script’s id', () => {
    const order = vaultDescribeOrder(
      [media('x'), media('y')],
      [script('s2', true, ['y']), script('s1', true, ['x', 'x'])],
    );
    expect(ids(order)).toEqual(['x', 'y']);
  });

  it('keeps every candidate of a folder or a script, each once', () => {
    const candidates = [media('a'), media('b'), media('c')];
    const order = vaultDescribeOrder(candidates, [script('s', true, ['c', 'a', 'c'])]);
    expect([...ids(order)].sort()).toEqual(['a', 'b', 'c']);
    expect(ids(order)).toEqual(['c', 'a', 'b']);
  });

  it('describes a media of the root she asked, a script’s first, the others after the folders (ADR 0145 § 5)', () => {
    const root = { folderRef: null, folderName: null };
    const order = vaultDescribeOrder(
      [media('loose_root', root), media('in_folder'), media('scripted_root', root)],
      [script('s', false, ['scripted_root'])],
    );
    expect(ids(order)).toEqual(['scripted_root', 'in_folder', 'loose_root']);
  });
});

describe('isMpegTs', () => {
  it('knows an MPEG-TS stream by its sync byte every 188 bytes', () => {
    const stream = new Uint8Array(376);
    stream[0] = 0x47;
    stream[188] = 0x47;
    expect(isMpegTs(stream)).toBe(true);
    expect(isMpegTs(stream.subarray(0, 100))).toBe(false);
    expect(isMpegTs(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});
