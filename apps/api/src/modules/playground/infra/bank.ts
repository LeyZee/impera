import type { VoiceBank } from '@impera/contracts';

import { checkVoiceOutput, pickVoiceExamples, type GuardSettings } from '../../agent/index';
import { VoiceExampleNotFound } from '../application/engine';
import { guardLabel } from '../domain/labels';

import type { VoiceBankStore } from './db/rating-store';

/** Her bank as Entraîner shows it and empties it (ADR 0102 § 5): one per creator, judged by the version chosen's guards. */
export interface VoiceBankView {
  list(creatorId: string, versionId: string): Promise<VoiceBank>;
  withdraw(creatorId: string, id: string): Promise<void>;
}

/**
 * Each example says whether her voice reads it now, chosen by the same function as her drafts (ADR 0102 § 2), and
 * which guard stops it when one does (§ 4): one filed blocked, or an active one her guards stop since.
 */
export function createVoiceBankView(deps: {
  readonly store: VoiceBankStore;
  /** Her guards for that version; null when the version is not hers. */
  readonly guardsOf: (creatorId: string, versionId: string) => Promise<GuardSettings | null>;
  readonly now: () => Date;
}): VoiceBankView {
  return {
    async list(creatorId, versionId) {
      const guards = await deps.guardsOf(creatorId, versionId);
      if (guards === null) return { examples: [] };
      const entries = await deps.store.list(creatorId);
      const read = new Set(
        pickVoiceExamples(
          entries.filter((e) => e.state === 'active'),
          guards,
        ).map((e) => e.id),
      );
      return {
        examples: entries.map((entry) => {
          const blockedBy = checkVoiceOutput([entry.text], guards).filter((v) => v.severity === 'blocking');
          return {
            id: entry.id,
            text: entry.text,
            fanMessage: entry.fanMessage,
            ratedAt: entry.ratedAt.toISOString(),
            state: entry.state === 'blocked' || blockedBy.length > 0 ? 'blocked' : 'active',
            isRead: read.has(entry.id),
            blockedBy: blockedBy.map((v) => ({
              code: v.code,
              label: guardLabel(v.code),
              severity: v.severity,
              ...(v.match !== undefined && { match: v.match }),
            })),
          };
        }),
      };
    },
    async withdraw(creatorId, id) {
      if (!(await deps.store.withdraw(creatorId, id, deps.now()))) throw new VoiceExampleNotFound();
    },
  };
}
