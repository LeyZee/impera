// @vitest-environment jsdom
import { InstagramPostCodeSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { watchPageOf } from './pages';
import {
  isEmptySnapshot,
  isPrivateProfile,
  postRootOf,
  readPost,
  readTile,
  reelRootOf,
  shownText,
  tilesOf,
} from './reader';

/*
 * Pages made up for these tests, after the shape of instagram.com's markup (ADR 0010: never a page recorded on a real
 * account). Accounts, codes, sounds and figures are invented.
 */

const CODE = InstagramPostCodeSchema.parse('Cx0abc12DEf');
const OTHER = InstagramPostCodeSchema.parse('Dy9zyx98WVu');

function page(body: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><body>${body}</body></html>`, 'text/html');
}

const POST_PAGE = `
<main>
  <article>
    <header>
      <a href="/atelier.lune/"><img alt="Photo de profil de atelier.lune"></a>
      <a href="/atelier.lune/"><span>atelier.lune</span></a>
      <div role="button">Suivre</div>
    </header>
    <div><img alt=""></div>
    <section>
      <span><svg aria-label="J’aime"></svg></span>
      <span><svg aria-label="Commenter"></svg></span>
    </section>
    <section><a href="/p/${CODE}/liked_by/"><span>1&nbsp;234 mentions J’aime</span></a></section>
    <ul>
      <li>
        <a href="/atelier.lune/">atelier.lune</a>
        <h1 dir="auto">Trois façons de porter un foulard en automne
          <a href="/explore/tags/foulard/">#foulard</a> #Automne
          <span role="button">… plus</span></h1>
      </li>
    </ul>
    <a href="/p/${CODE}/c/1/">Afficher les 120 commentaires</a>
    <a href="/p/${CODE}/"><time datetime="2026-10-30T09:00:00.000Z">30 octobre</time></a>
  </article>
</main>`;

const REELS_FEED = `
<main>
  <div class="reel">
    <video></video>
    <div>
      <a href="/danse.studio/"><span>danse.studio</span></a>
      <div role="button">Suivre</div>
      <span dir="auto">Le pas qui fait le tour des soirées 💃 #danse</span>
      <a href="/reels/audio/1234567890123/"><span dir="auto">Nuit d’été · Orchestre inventé</span></a>
    </div>
    <div>
      <div role="button"><svg aria-label="J’aime"></svg></div><span>12,3&nbsp;k</span>
      <div role="button"><svg aria-label="Commenter"></svg></div><span>842</span>
    </div>
  </div>
  <div class="reel">
    <video></video>
    <div><a href="/autre.compte/"><span>autre.compte</span></a></div>
    <div><div role="button"><svg aria-label="J’aime"></svg></div><span>9</span></div>
  </div>
</main>`;

const PROFILE_REELS = `
<main>
  <header><h2>atelier.lune</h2></header>
  <div>
    <a href="/atelier.lune/reel/${CODE}/">
      <div><span><svg aria-label="Icône du nombre de vues"></svg></span><span>1,2&nbsp;M</span></div>
    </a>
    <a href="/atelier.lune/reel/${OTHER}/">
      <div><span><svg aria-label="Icône du nombre de vues"></svg></span><span>48,5 k</span></div>
    </a>
    <a href="/atelier.lune/">pas un post</a>
  </div>
</main>`;

describe('readPost on a post page', () => {
  const doc = page(POST_PAGE);
  const root = postRootOf(doc, CODE);

  it('finds the article of the post', () => {
    expect(root?.tagName).toBe('ARTICLE');
  });

  it('reads what the page shows, and nothing it does not', () => {
    if (root === null) throw new Error('no root');
    expect(readPost(root, { code: CODE, path: 'post' })).toEqual({
      code: CODE,
      path: 'post',
      account: 'atelier.lune',
      metrics: { views: null, likes: 1234, comments: 120 },
      caption: 'Trois façons de porter un foulard en automne #foulard #Automne',
      hashtags: ['foulard', 'automne'],
      sound: null,
      soundId: null,
    });
  });

  it('keeps a caption cut by « plus » as shown, without the button', () => {
    if (root === null) throw new Error('no root');
    expect(readPost(root, { code: CODE, path: 'post' }).caption).not.toContain('plus');
  });
});

describe('readPost on the Reels feed', () => {
  const doc = page(REELS_FEED);
  const [first, second] = Array.from(doc.querySelectorAll('video'));

  it('finds each reel from its video', () => {
    if (first === undefined || second === undefined) throw new Error('no video');
    expect(reelRootOf(first)?.className).toBe('reel');
    expect(reelRootOf(second)?.className).toBe('reel');
  });

  it('reads the account, caption, sound with its id and the counts under the icons', () => {
    const root = first === undefined ? null : reelRootOf(first);
    if (root === null) throw new Error('no root');
    expect(readPost(root, { code: CODE, path: 'reel' })).toEqual({
      code: CODE,
      path: 'reel',
      account: 'danse.studio',
      metrics: { views: null, likes: 12_300, comments: 842 },
      caption: 'Le pas qui fait le tour des soirées 💃 #danse',
      hashtags: ['danse'],
      sound: 'Nuit d’été · Orchestre inventé',
      soundId: '1234567890123',
    });
  });

  it('leaves unknown what a reel does not show', () => {
    const root = second === undefined ? null : reelRootOf(second);
    if (root === null) throw new Error('no root');
    const snapshot = readPost(root, { code: OTHER, path: 'reel' });
    expect(snapshot.metrics).toEqual({ views: null, likes: 9, comments: null });
    expect(snapshot.caption).toBeNull();
    expect(snapshot.sound).toBeNull();
  });
});

describe('readTile on a profile’s Reels tab', () => {
  const doc = page(PROFILE_REELS);
  const reelsTab = watchPageOf('/atelier.lune/reels/');
  const postsTab = watchPageOf('/atelier.lune/');
  if (reelsTab === null || postsTab === null) throw new Error('pages');

  it('lists the tiles, never a link that is not a post', () => {
    expect(tilesOf(doc)).toHaveLength(2);
  });

  it('reads the views, the one place they show, and the profile as the account', () => {
    expect(tilesOf(doc).map((tile) => readTile(tile, reelsTab))).toEqual([
      expect.objectContaining({
        code: CODE,
        account: 'atelier.lune',
        metrics: { views: 1_200_000, likes: null, comments: null },
      }),
      expect.objectContaining({ code: OTHER, metrics: { views: 48_500, likes: null, comments: null } }),
    ]);
  });

  it('reads no views off another tab', () => {
    const [tile] = tilesOf(doc);
    if (tile === undefined) throw new Error('no tile');
    expect(readTile(tile, postsTab)?.metrics.views).toBeNull();
  });
});

describe('the watch’s limits', () => {
  it('sees a private profile', () => {
    expect(isPrivateProfile(page('<main><h2>Ce compte est privé</h2></main>'))).toBe(true);
    expect(isPrivateProfile(page(PROFILE_REELS))).toBe(false);
  });

  it('calls a post read with nothing but its address empty, the sign Instagram changed its page', () => {
    const doc = page(`<main><article><div><img alt=""></div><a href="/p/${CODE}/">x</a></article></main>`);
    const root = postRootOf(doc, CODE);
    if (root === null) throw new Error('no root');
    expect(isEmptySnapshot(readPost(root, { code: CODE, path: 'post' }))).toBe(true);
    const full = postRootOf(page(POST_PAGE), CODE);
    if (full === null) throw new Error('no root');
    expect(isEmptySnapshot(readPost(full, { code: CODE, path: 'post' }))).toBe(false);
  });

  it('prefers the post opened in a dialog over the grid behind it', () => {
    const doc = page(
      `${PROFILE_REELS}<div role="dialog">${POST_PAGE.replace('<main>', '').replace('</main>', '')}</div>`,
    );
    expect(postRootOf(doc, CODE)?.closest('[role="dialog"]')).not.toBeNull();
    expect(tilesOf(doc)).toHaveLength(2);
  });

  it('reads text as shown, without the text of buttons inside it', () => {
    const doc = page('<p id="x">Bonjour <span role="button">Traduire</span> à tous</p>');
    const element = doc.getElementById('x');
    if (element === null) throw new Error('no element');
    expect(shownText(element)).toBe('Bonjour à tous');
  });
});
