import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  RedirectLinkIdSchema,
  TelegramChannelConfigSchema,
  labelHasAddress,
} from './telegram-channel';

const id = RedirectLinkIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const link = { id, name: 'Redirection', url: 'https://redirection.example/lina', destination: '' };

describe('the setting of a creator’s Telegram channel (ADR 0080)', () => {
  it('asks for the words of the link only when the link is carried by words', () => {
    const bare = { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, linkForm: 'bare' as const, linkLabel: '' };
    expect(TelegramChannelConfigSchema.safeParse(bare).success).toBe(true);
    expect(TelegramChannelConfigSchema.safeParse({ ...bare, linkForm: 'label' }).success).toBe(false);
  });

  it('refuses two links under one id', () => {
    const config = { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, links: [link, { ...link, name: 'Autre' }] };
    expect(TelegramChannelConfigSchema.safeParse(config).success).toBe(false);
  });

  it('reads a link stored before « où il mène » as leading nowhere named, and refuses an address there', () => {
    const before = { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, links: [{ id, name: 'Reveal', url: link.url }] };
    expect(TelegramChannelConfigSchema.parse(before).links[0]?.destination).toBe('');
    const withAddress = { ...before, links: [{ ...link, destination: 'mon live sur tiktok.com/@nora' }] };
    expect(TelegramChannelConfigSchema.safeParse(withAddress).success).toBe(false);
  });

  it('finds an address in the words of the link, bare domains included', () => {
    for (const text of [
      'https://x.example',
      'www.reveal.me',
      'bit.ly/abc',
      'viens sur t.me',
      'reveal.me/messa ✨',
    ]) {
      expect(labelHasAddress(text)).toBe(true);
    }
    for (const text of [
      'Viens me parler ✨',
      'Ce soir… je t’attends',
      'Clique ici 💌',
      'mon live TikTok ce soir 21 h',
      'M. Dupont, env. 21h30.',
      'mon Reveal.Viens vite',
      'la St.Valentin',
    ]) {
      expect(labelHasAddress(text)).toBe(false);
    }
  });
});
