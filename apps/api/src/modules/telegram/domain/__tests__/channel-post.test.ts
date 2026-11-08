import { describe, expect, it } from 'vitest';

import {
  channelChecks,
  escapeHtml,
  renderChannelPost,
  segmentsOf,
  TELEGRAM_CAPTION_MAX,
} from '../channel-post';

const link = { text: 'Viens me parler ✨', url: 'https://redirect.example.test/a?x=1&y="2"', name: 'Reveal' };

describe('a post of her channel as Telegram shows it (ADR 0080 § 5)', () => {
  it('cuts her text on the bold and underline marks, and leaves an open mark as typed', () => {
    expect(segmentsOf('Ce soir **live** et __surprise__ 💫')).toEqual([
      { text: 'Ce soir ', style: 'plain' },
      { text: 'live', style: 'bold' },
      { text: ' et ', style: 'plain' },
      { text: 'surprise', style: 'underline' },
      { text: ' 💫', style: 'plain' },
    ]);
    expect(segmentsOf('5 ** 2 et mon_prénom_ici')).toEqual([
      { text: '5 ** 2 et mon_prénom_ici', style: 'plain' },
    ]);
    expect(segmentsOf('****')).toEqual([{ text: '****', style: 'plain' }]);
  });

  it('escapes everything the voice wrote, so no tag of hers reaches Telegram', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    const post = renderChannelPost('**<b>moi</b>** & toi', null);
    expect(post.html).toBe('<b>&lt;b&gt;moi&lt;/b&gt;</b> &amp; toi');
    expect(post.link).toBeNull();
  });

  it('adds the link at the end, its address escaped in the attribute, or bare', () => {
    expect(renderChannelPost('Coucou', link).html).toBe(
      'Coucou\n\n<a href="https://redirect.example.test/a?x=1&amp;y=&quot;2&quot;">Viens me parler ✨</a>',
    );
    const bare = { ...link, text: link.url };
    expect(renderChannelPost('Coucou', bare).html).toBe(
      'Coucou\n\nhttps://redirect.example.test/a?x=1&amp;y=&quot;2&quot;',
    );
  });

  it('refuses an address in her words, and a post longer than a caption', () => {
    expect(channelChecks(renderChannelPost('Viens sur tiktok.com/@moi', link))).toEqual([
      { code: 'contact_info', blocking: true, match: null },
    ]);
    expect(
      channelChecks({ kind: 'poll', question: 'Vous préférez ?', options: ['Reveal.me', 'Le live'] }),
    ).toEqual([{ code: 'contact_info', blocking: true, match: null }]);
    expect(channelChecks(renderChannelPost('a'.repeat(TELEGRAM_CAPTION_MAX), link))).toEqual([
      { code: 'bubble_too_long', blocking: true, match: null },
    ]);
    expect(channelChecks(renderChannelPost('Ce soir je réponds à tout le monde ✨', link))).toEqual([]);
  });
});
