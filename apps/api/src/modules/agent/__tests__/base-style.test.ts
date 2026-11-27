import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { StoredPersonaSchema, type AgencyStyleContent } from '@impera/contracts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { fakeGateway, type GatewaySeen } from '../../../__tests__/support/llm';
import { publicBaseStyleOf, startDraftComposer, type BaseStyleSource } from '../index';

// Invented texts (CLAUDE.md: no real style, fan or creator in a test).
const STYLE: AgencyStyleContent = {
  publicStyle: 'Phrase de style publique inventée',
  privateStyle: 'Phrase de style inventée',
  form: { capitalization: 'capital', mark_spacing: 'space', emoji_streak_max: 5 },
};

const persona = StoredPersonaSchema.parse(
  parse(
    readFileSync(
      fileURLToPath(new URL('../../../../../../personas/demo/v0.7.0.yaml', import.meta.url)),
      'utf8',
    ),
  ),
);

const INPUT = {
  creatorId: 'creator-1',
  conversationId: 'conversation-1',
  fanId: 'fan-1',
  draftId: 'draft-1',
  correlationId: 'correlation-1',
  now: new Date('2026-10-17T10:00:00Z'),
  platformAccountId: 'account-1',
  platformConversationId: 'thread-1',
  history: [{ direction: 'inbound' as const, text: 'Salut', at: new Date('2026-10-17T09:59:00Z') }],
  fan: { notes: [], spentMinor: 0, firstMessageAt: new Date('2026-10-17T09:58:00Z') },
};

async function draftWith(baseStyleOf?: BaseStyleSource) {
  const seen: GatewaySeen = { voiceCalls: 0, traces: [], voiceInputs: [] };
  const composer = startDraftComposer({
    gateway: fakeGateway({ voice: { bubbles: ['ça te dit?'] } }, seen),
    activePersona: () => Promise.resolve({ id: 'version-1', creatorName: 'Demo', persona }),
    timeZoneOf: () => Promise.resolve('Europe/Paris'),
    ...(baseStyleOf !== undefined && { baseStyleOf }),
  });
  return { draft: await composer.compose(INPUT), seen };
}

describe('the agency’s base style in a draft (ADR 0173)', () => {
  it('gives the voice its texts and the form it sets, under her persona’s', async () => {
    const { draft, seen } = await draftWith(() => Promise.resolve(STYLE));
    expect(seen.voiceInputs?.[0]?.agencyStyle).toEqual({
      publicStyle: STYLE.publicStyle,
      privateStyle: STYLE.privateStyle,
    });
    // Capital and space from the base style; her persona sets her own emoji streak.
    expect(draft).toMatchObject({ bubbles: ['Ça te dit ?'] });
  });

  it('writes without it when there is none or it cannot be read', async () => {
    for (const source of [undefined, () => Promise.resolve(null), () => Promise.reject(new Error('down'))]) {
      const { draft, seen } = await draftWith(source);
      expect(seen.voiceInputs?.[0]?.agencyStyle).toBeUndefined();
      expect(draft).toMatchObject({ bubbles: ['ça te dit?'] });
    }
  });

  it('gives a public reply the public part only, none when empty or unreadable', async () => {
    expect(await publicBaseStyleOf(() => Promise.resolve(STYLE))).toBe(STYLE.publicStyle);
    expect(await publicBaseStyleOf(() => Promise.resolve({ ...STYLE, publicStyle: '  ' }))).toBeNull();
    expect(await publicBaseStyleOf(() => Promise.resolve(null))).toBeNull();
    expect(await publicBaseStyleOf(() => Promise.reject(new Error('down')))).toBeNull();
  });
});
