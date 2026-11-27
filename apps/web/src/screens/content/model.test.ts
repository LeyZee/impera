import {
  ContentDropIdSchema,
  DROP_CATEGORY_LABELS,
  NOT_WHAT_IT_SAYS,
  type RedoneDrop,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { dropOf, fileOf, fileWithHead, requestOf } from './fixtures';
import {
  acceptOf,
  acceptOfReplacing,
  contentsOf,
  droppedOn,
  dropName,
  dueOf,
  fileLine,
  lengthOf,
  matchResumed,
  measuredVideoRefusal,
  mediaLabel,
  mimeOf,
  moved,
  onTheirWay,
  openRequests,
  outLine,
  pickedHeadRefusal,
  published,
  mayWithdrawHere,
  linesOf,
  remainingOf,
  routeFirst,
  sameFile,
  shotMomentOf,
  stateTone,
  stateWord,
  toRedo,
  toReplaceOf,
  toShoot,
  UNREADABLE_HERE,
  weightOf,
} from './model';

describe('Contenu: a video measured on her phone (recette MED-04)', () => {
  it('refuses a landscape video for a vertical category before it goes up', () => {
    expect(measuredVideoRefusal('feed_video', { ms: 20_000, width: 1920, height: 1080 })).toBe(
      '« Feed · Vidéo short » : la vidéo doit être verticale',
    );
    expect(measuredVideoRefusal('feed_video', { ms: 20_000, width: 1080, height: 1920 })).toBeNull();
    expect(measuredVideoRefusal('feed_shoot', { ms: 20_000, width: 1920, height: 1080 })).toBeNull();
  });

  it('leaves to the server a video her phone could not measure', () => {
    expect(measuredVideoRefusal('feed_video', { ms: 20_000, width: null, height: null })).toBeNull();
    expect(measuredVideoRefusal('feed_video', { ms: null, width: 1920, height: 1080 })).toBeNull();
  });
});

describe('Contenu: the rules of her screen (CR-06 d)', () => {
  it('reads a file’s type from her browser, or from its extension when the browser gives none', () => {
    expect(mimeOf({ name: 'IMG_0001.MOV', type: 'video/quicktime' })).toBe('video/quicktime');
    expect(mimeOf({ name: 'clip.mkv', type: '' })).toBe('video/x-matroska');
    expect(mimeOf({ name: 'photo.HEIC', type: '' })).toBe('image/heic');
    expect(mimeOf({ name: 'notes.pdf', type: 'application/pdf' })).toBeNull();
  });

  it('offers in the gallery only what the category takes', () => {
    expect(acceptOf('feed_video')).not.toContain('image/*');
    expect(acceptOf('feed_video')).toContain('.mkv');
    expect(acceptOf('mass_dm')).toContain('audio/*');
  });

  it('lists her open requests, the nearest first, without those a drop already answers', () => {
    const later = requestOf({ dueOn: '2026-11-10' });
    const sooner = requestOf({ dueOn: '2026-11-06' });
    const answered = requestOf({ dueOn: '2026-11-05', dropId: dropOf().id });
    const refused = requestOf({ state: 'refused' });
    expect(openRequests([later, answered, sooner, refused], []).map((r) => r.id)).toEqual([
      sooner.id,
      later.id,
    ]);
  });

  it('keeps a request in « À tourner » while its drop still goes up, until it is received (recette CRE-12)', () => {
    const goingUp = dropOf({ state: 'uploading' });
    const received = dropOf({ state: 'received' });
    const filling = dropOf({ category: 'script', state: 'filling' });
    const waiting = requestOf({ dueOn: '2026-11-06', dropId: goingUp.id });
    const answered = requestOf({ dueOn: '2026-11-07', dropId: received.id });
    const shooting = requestOf({ dueOn: '2026-11-08', category: 'script', dropId: filling.id });
    const open = requestOf({ dueOn: '2026-11-09' });
    expect(
      openRequests([open, shooting, answered, waiting], [goingUp, received, filling]).map((r) => r.id),
    ).toEqual([waiting.id, open.id]);
    // Its drop not read: it is answered, as the server says.
    expect(openRequests([waiting], [])).toEqual([]);
  });

  it('reads a picked file’s first bytes as the server does (recette CRE-12)', async () => {
    expect(await pickedHeadRefusal(fileWithHead('a.jpg', 'jpeg'), 'image/jpeg')).toBeNull();
    expect(await pickedHeadRefusal(fileWithHead('a.heic', 'heic'), 'image/heic')).toBeNull();
    expect(await pickedHeadRefusal(fileWithHead('a.mov', 'mov'), 'video/quicktime')).toBeNull();
    expect(await pickedHeadRefusal(new File(['juste du texte'], 'faux.jpg'), 'image/jpeg')).toBe(
      NOT_WHAT_IT_SAYS,
    );
    // A HEIC renamed `.jpg` is not what it says either.
    expect(await pickedHeadRefusal(fileWithHead('a.jpg', 'heic'), 'image/jpeg')).toBe(NOT_WHAT_IT_SAYS);
    // A file her phone cannot open here is said, never guessed.
    const broken = new File(['x'], 'x.jpg');
    broken.slice = () => {
      throw new Error('unreadable');
    };
    expect(await pickedHeadRefusal(broken, 'image/jpeg')).toBe(UNREADABLE_HERE);
  });

  it('puts a drop on its way until it is out, and never shows a withdrawn one', () => {
    const drops = [
      dropOf({ state: 'uploading' }),
      dropOf({ state: 'published' }),
      dropOf({ state: 'withdrawn' }),
      dropOf({ state: 'blocked', blockedReason: '« Vidéo feed » : la vidéo doit être verticale' }),
    ];
    expect(onTheirWay(drops).map((d) => d.state)).toEqual(['uploading', 'blocked']);
    expect(published(drops).map((d) => d.state)).toEqual(['published']);
  });

  it('takes a script copied into Reveal out of « En route », by its number (recette créatrice 8)', () => {
    const copied = dropOf({
      category: 'script',
      state: 'ready',
      scriptNumber: 1,
      files: [fileOf({ kind: 'image' }), fileOf({ kind: 'video' })],
      createdAt: '2026-11-09T10:00:00.000Z',
      exportedAt: '2026-11-10T15:00:00.000Z',
    });
    const sent = { ...copied, exportedAt: null };
    expect(onTheirWay([copied, sent])).toEqual([sent]);
    expect(published([copied, sent])).toEqual([copied]);
    expect(dropName(copied)).toBe('Script S001');
    expect(dropName(dropOf({ category: 'feed_shoot' }))).toBe(DROP_CATEGORY_LABELS.feed_shoot);
    expect(outLine(copied, '2026-11-11', 'Europe/Paris')).toBe('1 photo · 1 vidéo · dans Reveal depuis hier');
    expect(outLine({ ...copied, exportedAt: '2026-10-20T15:00:00.000Z' }, '2026-11-11', 'Europe/Paris')).toBe(
      '1 photo · 1 vidéo · dans Reveal depuis le 20 oct.',
    );
    // Put out by the agency elsewhere than Reveal (recette créatrice 1): her line says where.
    const reel = dropOf({
      category: 'instagram_reel',
      files: [fileOf({ kind: 'video' })],
      exportedAt: copied.exportedAt,
    });
    expect(published([reel])).toEqual([reel]);
    expect(outLine(reel, '2026-11-11', 'Europe/Paris')).toBe('1 vidéo · sur Instagram depuis hier');
  });

  it('turns amber only a blocked drop: she has something to do', () => {
    expect(stateTone(dropOf({ state: 'blocked', blockedReason: 'x' }))).toBe('warn');
    expect(stateTone(dropOf({ state: 'received' }))).toBe('calm');
    expect(stateTone(dropOf({ state: 'ready' }))).toBe('ok');
  });

  it('says what a drop holds, by kind', () => {
    const files = [
      fileOf({ kind: 'video' }),
      fileOf({ kind: 'image' }),
      fileOf({ kind: 'image' }),
      fileOf({ kind: 'audio' }),
    ];
    expect(contentsOf(files)).toBe('2 photos · 1 vidéo · 1 vocal');
  });

  it('says where each file is: its progress here, « En préparation » while it is cleaned or converted', () => {
    const awaiting = fileOf({ state: 'awaiting' });
    expect(fileLine(awaiting, undefined)).toBe('Envoi interrompu');
    expect(fileLine(awaiting, { sent: 0, total: 10, rate: null, phase: 'queued' })).toBe('En attente');
    expect(fileLine(awaiting, { sent: 500, total: 1000, rate: null, phase: 'sending' })).toBe('50 %');
    expect(
      fileLine(awaiting, { sent: 500_000_000, total: 1_000_000_000, rate: 5_000_000, phase: 'sending' }),
    ).toBe('50 % · encore 2 min');
    expect(fileLine(awaiting, { sent: 5, total: 10, rate: 1, phase: 'waiting' })).toBe(
      'Réseau coupé : ça reprend tout seul',
    );
    // The server answers with an error: not the network, said otherwise (recette CRE-10).
    expect(fileLine(awaiting, { sent: 5, total: 10, rate: null, phase: 'stalled' })).toBe(
      'L’envoi n’aboutit pas pour l’instant',
    );
    expect(fileLine(fileOf({ state: 'received' }), undefined)).toBe('En préparation');
    expect(fileLine(fileOf({ state: 'duplicate' }), undefined)).toBe('Déjà dans ta médiathèque');
    expect(fileLine(fileOf({ state: 'refused', refusal: 'Une photo fait au plus 30 Mo' }), undefined)).toBe(
      'Une photo fait au plus 30 Mo',
    );
  });

  it('says weights and times as she reads them', () => {
    expect(weightOf(340_000_000)).toBe('340 Mo');
    expect(weightOf(1_200_000_000)).toBe('1,2 Go');
    // Under a megabyte, in Ko: never « 1 Mo » for a photo of 9 Ko or an empty file (recette MED-02).
    expect(weightOf(8_894)).toBe('9 Ko');
    expect(weightOf(0)).toBe('0 Ko');
    expect(weightOf(300)).toBe('1 Ko');
    expect(weightOf(999_600)).toBe('1 Mo');
    expect(remainingOf(42)).toBe('40 s');
    expect(remainingOf(3900)).toBe('1 h 05');
  });

  it('keeps each refused file of a settled drop, with its reason, and only then (recette MED-03)', () => {
    const refused = fileOf({
      state: 'refused',
      refusal: '« Feed · Vidéo short » : la vidéo doit être verticale',
    });
    const kept = fileOf({ state: 'kept' });
    expect(linesOf(dropOf({ state: 'blocked', files: [refused] }))).toEqual([refused]);
    expect(linesOf(dropOf({ state: 'ready', files: [kept, refused] }))).toEqual([refused]);
    expect(linesOf(dropOf({ state: 'ready', files: [kept] }))).toEqual([]);
    expect(linesOf(dropOf({ state: 'uploading', files: [refused] }))).toEqual([]);
  });

  it('offers « Retirer » on a drop she may withdraw, never on a script copied into Reveal (recette MED-08)', () => {
    expect(mayWithdrawHere(dropOf({ state: 'ready' }))).toBe(true);
    expect(mayWithdrawHere(dropOf({ state: 'ready', exportedAt: '2026-11-06T17:57:40.993Z' }))).toBe(false);
  });

  it('says when a script asked of her is shot, as its request fixed (recette MED-05)', () => {
    expect(shotMomentOf(requestOf({ category: 'script', moment: 'night' }))).toBe('🌙 Nuit');
    expect(shotMomentOf(requestOf({ category: 'script', moment: 'day' }))).toBe('☀️ Jour');
    expect(shotMomentOf(requestOf({ category: 'script', moment: null }))).toBeNull();
    expect(shotMomentOf(requestOf({ category: 'feed_shoot', moment: null }))).toBeNull();
  });

  it('says when a request is due, and since when it is late', () => {
    // 05/11/2026 is a Thursday.
    expect(dueOf('2026-11-05', '2026-11-05')).toEqual({ text: 'Pour aujourd’hui', late: false });
    expect(dueOf('2026-11-06', '2026-11-05')).toEqual({ text: 'Pour demain', late: false });
    expect(dueOf('2026-11-09', '2026-11-05')).toEqual({ text: 'Pour lundi', late: false });
    expect(dueOf('2026-11-20', '2026-11-05')).toEqual({ text: 'Pour le 20 nov.', late: false });
    expect(dueOf('2026-11-02', '2026-11-05')).toEqual({ text: 'En retard depuis lun. 2 nov.', late: true });
    // Another year's day says its year (recette MED-10).
    expect(dueOf('2026-01-01', '2026-11-05')).toEqual({ text: 'En retard depuis jeu. 1 janv.', late: true });
    expect(dueOf('2025-01-01', '2026-11-05')).toEqual({
      text: 'En retard depuis mer. 1 janv. 2025',
      late: true,
    });
    expect(dueOf('2027-01-08', '2026-11-05')).toEqual({ text: 'Pour le 8 janv. 2027', late: false });
  });

  it('says when she dropped it, in her own time', () => {
    expect(droppedOn('2026-11-04T23:30:00Z', '2026-11-05', 'Europe/Paris')).toBe('Aujourd’hui');
    expect(droppedOn('2026-11-04T10:00:00Z', '2026-11-05', 'Europe/Paris')).toBe('Hier');
    expect(droppedOn('2026-11-02T10:00:00Z', '2026-11-05', 'Europe/Paris')).toBe('Lundi');
  });

  it('moves a file one place up or down, and never past either end', () => {
    expect(moved(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('knows the same file picked twice', () => {
    const file = { name: 'IMG_1.HEIC', size: 3, lastModified: 1 };
    expect(sameFile(file, { ...file })).toBe(true);
    expect(sameFile(file, { ...file, lastModified: 2 })).toBe(false);
  });

  it('keeps a script she began in « À tourner » with its request, by due day, out of « En route » (CRE-12)', () => {
    const script = requestOf({ category: 'script', dueOn: '2026-11-08' });
    const begun = dropOf({ category: 'script', state: 'filling', files: [], requestId: script.id });
    const soon = requestOf({ dueOn: '2026-11-06' });
    const later = requestOf({ dueOn: '2026-11-10' });
    const items = toShoot([later, { ...script, dropId: begun.id }, soon], [begun]);
    expect(
      items.map((item) => (item.kind === 'script' ? `script:${item.request?.id ?? ''}` : item.request.id)),
    ).toEqual([soon.id, `script:${script.id}`, later.id]);
    expect(onTheirWay([begun])).toEqual([]);
  });

  it('puts « En route » first while a file is still to go up (CRE-09)', () => {
    expect(routeFirst([dropOf({ state: 'uploading', files: [fileOf({ state: 'awaiting' })] })])).toBe(true);
    expect(routeFirst([dropOf({ state: 'received', files: [fileOf({ state: 'received' })] })])).toBe(false);
    expect(routeFirst([])).toBe(false);
  });

  it('matches the files she chose again to the cut ones by weight, once each (CRE-10)', () => {
    const a = fileOf({ bytes: 3 });
    const b = fileOf({ bytes: 7 });
    const { pairs, unmatched } = matchResumed([a, b], [{ size: 7 }, { size: 3 }, { size: 3 }, { size: 1 }]);
    expect(pairs.map((pair) => pair.fileId)).toEqual([b.id, a.id]);
    expect(unmatched).toBe(2);
  });

  it('names a chosen file by its kind and length, never by its name (CRE-16)', () => {
    expect(mediaLabel('image', null)).toBe('Photo');
    expect(mediaLabel('video', 8_200)).toBe('Vidéo · 8 s');
    expect(mediaLabel('video', null)).toBe('Vidéo');
    expect(mediaLabel('audio', 65_000)).toBe('Vocal · 1 min 05');
    expect(mediaLabel(null, null)).toBe('Fichier');
    expect(lengthOf(200)).toBe('1 s');
  });
});

describe('Contenu: what the agency sent back (trou 7 du 21/11)', () => {
  const back = (category: RedoneDrop['category'], at: string, n: number): RedoneDrop => ({
    dropId: ContentDropIdSchema.parse(`00000000-0000-4000-8000-9000000000${String(n).padStart(2, '0')}`),
    category,
    redo: { sentence: 'Trop sombre', at },
  });

  it('shows the latest first, and forgets one once she drops that category again', () => {
    const story = back('reveal_story', '2026-11-05T10:00:00.000Z', 1);
    const seance = back('feed_shoot', '2026-11-06T10:00:00.000Z', 2);
    expect(toRedo([story, seance], [])).toEqual([seance, story]);
    const before = dropOf({ category: 'reveal_story', createdAt: '2026-11-04T10:00:00.000Z' });
    const gone = dropOf({
      category: 'reveal_story',
      state: 'withdrawn',
      createdAt: '2026-11-07T10:00:00.000Z',
    });
    expect(toRedo([story], [before, gone])).toEqual([story]);
    const again = dropOf({ category: 'reveal_story', createdAt: '2026-11-07T10:00:00.000Z' });
    expect(toRedo([story, seance], [again])).toEqual([seance]);
  });
});

describe('Contenu: a medium to replace (trou 7 du 21/11)', () => {
  const asked = fileOf({ redo: { sentence: 'Trop sombre', at: '2026-11-05T09:00:00.000Z' } });
  const refused = fileOf({ position: 1, state: 'refused', refusal: 'Photo illisible' });
  const kept = fileOf({ position: 2 });

  it('is one asked again or refused, in a drop received and not out, but a script copied into Reveal', () => {
    expect(toReplaceOf(dropOf({ state: 'ready', files: [asked, refused, kept] }))).toEqual([asked, refused]);
    expect(toReplaceOf(dropOf({ state: 'uploading', files: [asked] }))).toEqual([]);
    expect(toReplaceOf(dropOf({ state: 'scheduled', files: [asked] }))).toEqual([]);
    const out = '2026-11-04T09:00:00.000Z';
    expect(toReplaceOf(dropOf({ state: 'ready', exportedAt: out, files: [asked] }))).toEqual([]);
    const script = dropOf({
      category: 'script',
      scriptNumber: 3,
      requestId: requestOf({ category: 'script' }).id,
      state: 'ready',
      exportedAt: out,
      files: [{ ...asked, slotKey: 'salon::0' }],
    });
    expect(toReplaceOf(script)).toHaveLength(1);
    // Back on her way, above « Déposer », its line saying the team's sentence.
    expect(onTheirWay([script])).toEqual([script]);
    expect(published([script])).toEqual([]);
    expect(routeFirst([script])).toBe(true);
    expect(fileLine(asked, undefined)).toBe('Trop sombre');
    expect(linesOf(dropOf({ state: 'ready', files: [asked, kept] }))).toEqual([asked]);
  });

  it('shows the one she sent in its place going up, the drop on her way until its receipt settles it', () => {
    const sent = fileOf({ position: 0, state: 'awaiting' });
    const script = dropOf({
      category: 'script',
      scriptNumber: 3,
      requestId: requestOf({ category: 'script' }).id,
      state: 'ready',
      exportedAt: '2026-11-04T09:00:00.000Z',
      files: [{ ...sent, slotKey: 'salon::0' }],
    });
    expect(toReplaceOf(script)).toEqual([]);
    expect([stateWord(script), stateTone(script)]).toEqual(['En envoi', 'calm']);
    expect(onTheirWay([script])).toEqual([script]);
    expect(published([script])).toEqual([]);
    expect(routeFirst([script])).toBe(true);
    const preparing = dropOf({ state: 'blocked', files: [{ ...sent, state: 'received' }] });
    expect([stateWord(preparing), stateTone(preparing)]).toEqual(['Reçu', 'calm']);
    // Its line and the refused one's, on a settled drop.
    expect(linesOf(dropOf({ state: 'ready', files: [sent, kept] }))).toEqual([sent]);
    const settled = dropOf({ state: 'ready', files: [kept] });
    expect([stateWord(settled), stateTone(settled)]).toEqual(['Prêt', 'ok']);
  });

  it('opens her gallery on the step’s kind in a script, on the category’s kinds otherwise', () => {
    const seance = dropOf({ files: [asked] });
    expect(acceptOfReplacing(seance, asked)).toBe(acceptOf('feed_shoot'));
    const vocal = fileOf({ kind: 'audio', mime: 'audio/mpeg', slotKey: 'salon::2' });
    expect(acceptOfReplacing(dropOf({ category: 'script', requestId: requestOf().id }), vocal)).toBe(
      'audio/*,.m4a,.mp3,.aac',
    );
  });
});
