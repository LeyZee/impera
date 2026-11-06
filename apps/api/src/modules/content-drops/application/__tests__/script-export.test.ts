import { Readable } from 'node:stream';

import type { ScriptMoment, ScriptSegment } from '@impera/contracts';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { ContentDropExportUnprocessable, ContentDropStorageUnavailable } from '../../domain/errors';
import type { AgencyContentStore, DropStorage, ScriptVersions, SentScript } from '../../domain/ports';
import { exportScript } from '../script-export';

const NOW = new Date('2026-11-06T12:00:00.000Z');

/** Invented: one free stage with a photo and an optional video, one paid stage in two series. */
const segments: ScriptSegment[] = [
  {
    kind: 'stage',
    key: 'salon',
    name: 'Salon',
    intention: 'Elle se dévoile un peu',
    access: 'free',
    mood: null,
    outfit: null,
    place: null,
    mediaSlots: [
      { kind: 'image', optional: false, hint: null },
      { kind: 'video', optional: true, hint: null, minSeconds: 5, maxSeconds: 20 },
    ],
    variants: [],
  },
  {
    kind: 'stage',
    key: 'chambre',
    name: 'Chambre',
    intention: 'Elle se dévoile plus',
    access: 'paid',
    mood: null,
    outfit: null,
    place: null,
    mediaSlots: [{ kind: 'image', optional: false, hint: null }],
    variants: [
      { letter: 'A', hint: 'Lumière tamisée' },
      { letter: 'B', hint: 'Plein jour' },
    ],
  },
];

const refuse = (what: string) => (): Promise<never> => Promise.reject(new Error(`${what} not expected`));

function agencyWith(sent: SentScript): AgencyContentStore {
  return {
    content: refuse('content'),
    drop: refuse('drop'),
    correct: refuse('correct'),
    withdraw: refuse('withdraw'),
    ask: refuse('ask'),
    cancel: refuse('cancel'),
    fileTarget: refuse('fileTarget'),
    markSent: refuse('markSent'),
    sentScript: () => Promise.resolve(sent),
    confirmExport: refuse('confirmExport'),
  };
}

function versionsOf(moment: ScriptMoment): ScriptVersions {
  return {
    frozen: () => Promise.resolve({ name: 'Soirée inventée', moment, segments }),
    card: refuse('card'),
    folderCard: (_versionId, segmentKey, variant) =>
      Promise.resolve(new TextEncoder().encode(`carton ${segmentKey} ${variant ?? '-'}`)),
    freeze: refuse('freeze'),
  };
}

/** The storage's objects, each given in two chunks as a stream would. */
function storageOf(objects: Record<string, string>): DropStorage {
  return {
    openUpload: refuse('openUpload'),
    startUpload: refuse('startUpload'),
    storedParts: refuse('storedParts'),
    partUrl: refuse('partUrl'),
    completeUpload: refuse('completeUpload'),
    sizeOf: refuse('sizeOf'),
    remove: refuse('remove'),
    download: refuse('download'),
    upload: refuse('upload'),
    read: (key) => {
      const text = objects[key];
      if (text === undefined) return Promise.resolve(null);
      const bytes = new TextEncoder().encode(text);
      return Promise.resolve(Readable.from([bytes.slice(0, 3), bytes.slice(3)]));
    },
  };
}

const sent: SentScript = {
  scriptNumber: 12,
  versionId: 'version',
  moment: null,
  files: [
    { slotKey: 'chambre:B:0', mime: 'image/heic', bytes: 9, storageKey: 'media/b' },
    { slotKey: 'salon::0', mime: 'image/jpeg', bytes: 9, storageKey: 'media/s' },
    { slotKey: 'chambre:A:0', mime: 'image/jpeg', bytes: 9, storageKey: 'media/a' },
  ],
};
const objects = { 'media/s': 'photo-sal', 'media/a': 'photo-A..', 'media/b': 'photo-B..' };

async function bytesOf(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(parts));
}

describe('content-drops › a sent script’s archive (SC-03 c)', () => {
  it('zips the sheet, each card and each medium in the script’s order, under her script number', async () => {
    const archive = await exportScript(
      { agency: agencyWith(sent), versions: versionsOf('night'), storage: storageOf(objects) },
      'creator',
      'owner',
      'drop',
      NOW,
    );
    expect(archive.fileName).toBe('S012-nuit-soiree-inventee.zip');
    const files = unzipSync(await bytesOf(archive.stream));
    const decoded = (name: string) => new TextDecoder().decode(files[`S012-nuit-soiree-inventee/${name}`]);
    expect(Object.keys(files).map((name) => name.split('/')[1])).toEqual([
      '00-fiche.txt',
      '01-E1-00-carton.png',
      '01-E1-01-photo.jpg',
      '02-E2A-00-carton.png',
      '02-E2A-01-photo.jpg',
      '02-E2B-00-carton.png',
      '02-E2B-01-photo.heic',
    ]);
    expect(decoded('01-E1-01-photo.jpg')).toBe('photo-sal');
    expect(decoded('02-E2B-00-carton.png')).toBe('carton chambre B');
    expect(decoded('00-fiche.txt')).toContain('02 · E2 — Chambre (PAYANT)');
  });

  it('names a « both » structure by the moment its request fixed', async () => {
    const archive = await exportScript(
      {
        agency: agencyWith({ ...sent, moment: 'day' }),
        versions: versionsOf('both'),
        storage: storageOf(objects),
      },
      'creator',
      'owner',
      'drop',
      NOW,
    );
    expect(archive.fileName).toBe('S012-jour-soiree-inventee.zip');
    archive.stream.destroy();
  });

  it('refuses a « both » structure asked before its moment was fixed: it is not guessed', async () => {
    const refused = exportScript(
      { agency: agencyWith(sent), versions: versionsOf('both'), storage: storageOf(objects) },
      'creator',
      'owner',
      'drop',
      NOW,
    );
    await expect(refused).rejects.toThrow(ContentDropExportUnprocessable);
    await expect(refused).rejects.toMatchObject({ details: { reason: 'moment_unknown' } });
  });

  it('refuses media past 4 Gio before the first byte: a ZIP without ZIP64 would come out corrupt', async () => {
    const heavy: SentScript = {
      ...sent,
      files: sent.files.map((file) => ({ ...file, bytes: 1.5 * 1024 ** 3 })),
    };
    await expect(
      exportScript(
        { agency: agencyWith(heavy), versions: versionsOf('night'), storage: storageOf(objects) },
        'creator',
        'owner',
        'drop',
        NOW,
      ),
    ).rejects.toMatchObject({ details: { reason: 'too_large' } });
  });

  it('cuts the archive when a medium is gone from the storage', async () => {
    const archive = await exportScript(
      {
        agency: agencyWith(sent),
        versions: versionsOf('day'),
        storage: storageOf({ 'media/s': 'photo-sal' }),
      },
      'creator',
      'owner',
      'drop',
      NOW,
    );
    await expect(bytesOf(archive.stream)).rejects.toThrow(ContentDropStorageUnavailable);
  });
});
