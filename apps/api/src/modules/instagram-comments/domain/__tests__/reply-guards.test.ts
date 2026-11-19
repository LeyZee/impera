import { describe, expect, it } from 'vitest';

import { CHAT_GUARDS_ON_A_REPLY, checkReply, type ReplyGuardContext } from '../reply-guards';

const calm: ReplyGuardContext = { recentReplies: [], chatGuardCodes: [] };
const codes = (text: string, context: ReplyGuardContext = calm) =>
  checkReply(text, context).map((v) => v.code);

describe('the guards of a public reply (ADR 0122 § 3)', () => {
  it('lets a short, warm reply pass', () => {
    expect(codes('Merci, ça me fait plaisir 🌸')).toEqual([]);
  });

  it('refuses a reply that is empty, too long, with two emojis, a hashtag or a mention', () => {
    expect(codes('   ')).toContain('comment_format');
    expect(codes('a'.repeat(151))).toContain('comment_format');
    expect(codes('Merci 🌸🌸')).toContain('comment_format');
    expect(codes('Merci #dimanche')).toContain('comment_format');
    expect(codes('Merci @quelquun')).toContain('comment_format');
  });

  it('applies the Instagram guard of her captions: no adult platform, link, price nor « lien en bio »', () => {
    expect(codes('La suite est sur OnlyFans')).toContain('instagram_text');
    expect(codes('Regarde le lien en bio')).toContain('instagram_text');
    expect(codes('Va voir exemple.com')).toContain('instagram_text');
    expect(codes('Pour 10 € seulement')).toContain('instagram_text');
  });

  it('refuses an explicit or seductive word: a reply is public and for all audiences', () => {
    expect(codes('Tu me verras toute nue')).toContain('public_explicit');
    expect(codes('Tu es trop sexy toi')).toContain('public_explicit');
    expect(codes('Viens en privé')).toContain('public_explicit');
  });

  it('refuses a reply identical or nearly so to a recent one', () => {
    const context = { ...calm, recentReplies: ['Merci beaucoup, trop gentil de ta part'] };
    expect(codes('merci beaucoup trop gentil de ta part !', context)).toContain('repeated_reply');
    expect(codes('Contente que la lumière te plaise', context)).not.toContain('repeated_reply');
  });

  it('refuses a mention or a hashtag anywhere in the text, full-width forms too', () => {
    expect(codes('merci!@quelquun')).toContain('comment_format');
    expect(codes('(@quelquun) merci')).toContain('comment_format');
    expect(codes('merci ＠quelquun')).toContain('comment_format');
    expect(codes('merci＃dimanche')).toContain('comment_format');
  });

  it('refuses on every blocking code the chatting guards raise, not on a whitelist', () => {
    const context: ReplyGuardContext = {
      recentReplies: [],
      chatGuardCodes: [
        'ai_disclosure',
        'asks_for_nudes',
        'off_platform_payment',
        'assistant_output',
        'discount',
      ],
    };
    expect(codes('Merci à toi', context)).toEqual([
      'ai_disclosure',
      'asks_for_nudes',
      'off_platform_payment',
      'assistant_output',
      'discount',
    ]);
  });

  it('names the five chatting guards of a public reply, staying in character first', () => {
    expect(CHAT_GUARDS_ON_A_REPLY).toContain('ai_disclosure');
    for (const code of CHAT_GUARDS_ON_A_REPLY)
      expect(codes('Merci à toi', { recentReplies: [], chatGuardCodes: [code] })).toEqual([code]);
  });

  it('never carries the text in a violation: a rule name or word only', () => {
    const [violation] = checkReply('Regarde le lien en bio', calm);
    expect(violation?.detail).toBe('adult_platform');
  });
});
