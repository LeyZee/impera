import {
  CreatorIdSchema,
  PlatformAccountIdSchema,
  PreparedScriptIdSchema,
  type PreparedBranch,
  type PreparedScriptContent,
  type PreparedScriptView,
  type VaultChoicesView,
  type VaultView,
} from '@impera/contracts';

/* Invented data only (ADR 0010): a creator, an account, a vault and scripts that exist nowhere. */
export const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
export const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
export const SCRIPT = PreparedScriptIdSchema.parse('0192f3a0-0000-7000-8000-0000000000e1');

const key = (n: number): string => `0192f3a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const branchOf = (n: number, extra: Partial<PreparedBranch> = {}): PreparedBranch => ({
  key: key(n),
  condition: null,
  teaser: '',
  offerText: 'Un texte d’offre inventé',
  media: [{ ref: 'm1' }],
  afterMedia: { justAfter: '', unread: '', readNotBought: '' },
  priceMinor: 0,
  currency: 'EUR',
  ...extra,
});

export const CONTENT: PreparedScriptContent = {
  name: 'Soirée inventée',
  description: 'Une idée inventée pour les tests',
  moment: 'night',
  steps: [
    { key: key(101), rhythm: 0, branches: [branchOf(1)] },
    {
      key: key(102),
      rhythm: 3,
      branches: [
        branchOf(2, { condition: { kind: 'none' }, priceMinor: 1200, media: [{ ref: 'm2' }] }),
        branchOf(3, {
          condition: { kind: 'text', text: 'S’il aime le rouge' },
          priceMinor: 1500,
          media: [{ ref: 'm3' }],
        }),
      ],
    },
  ],
};

export const viewOf = (extra: Partial<PreparedScriptView> = {}): PreparedScriptView => ({
  id: SCRIPT,
  creatorId: CREATOR,
  platformAccountId: ACCOUNT,
  state: 'editing',
  language: 'french',
  versionOf: null,
  revision: 1,
  content: CONTENT,
  gaps: [],
  warnings: [],
  matchedPlatformScriptId: null,
  copyDifferences: null,
  createdAt: '2026-11-20T09:00:00.000Z',
  updatedAt: '2026-11-20T09:00:00.000Z',
  ...extra,
});

const mediaOf = (id: string) => ({
  platformMediaId: id,
  kind: 'image' as const,
  durationSeconds: null,
  uploadedAt: '2026-11-01T09:00:00.000Z',
  platformDescription: null,
  suggestedPriceMinor: null,
  blurhash: null,
  removed: false,
});

export const VAULT: VaultView = {
  creatorId: CREATOR,
  syncedAt: '2026-11-20T08:00:00.000Z',
  folders: [
    {
      platform: 'reveal',
      platformAccountId: ACCOUNT,
      folderRef: 'f1',
      folderName: 'Dossier inventé',
      moment: 'night',
      media: [mediaOf('m1'), mediaOf('m2'), mediaOf('m3'), mediaOf('m4'), mediaOf('m5')],
    },
  ],
};

export const CHOICES: VaultChoicesView = {
  creatorId: CREATOR,
  folders: [{ platformAccountId: ACCOUNT, folderRef: 'f1', imported: true }],
  media: [
    ...['m1', 'm2', 'm3', 'm4'].map((id) => ({
      platformAccountId: ACCOUNT,
      platformMediaId: id,
      imported: true,
      description: 'described' as const,
      excerpt: `Description inventée ${id}`,
    })),
    {
      platformAccountId: ACCOUNT,
      platformMediaId: 'm5',
      imported: true,
      description: 'none' as const,
      excerpt: null,
    },
  ],
};
