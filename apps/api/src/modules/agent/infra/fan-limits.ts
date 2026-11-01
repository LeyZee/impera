import { CreatorIdSchema, FanIdSchema, type FanFlags } from '@nirvana/contracts';

import type { FansModule } from '../../fans';
import type { Protection } from '../domain/hold';

/** His limits as the composer sees them: read before anything is written, set by the policy on a risk. */
export interface FanLimits {
  flags(creatorId: string, fanId: string): Promise<FanFlags>;
  /** `at` dates a sales freeze: the moment he said it. */
  protect(
    creatorId: string,
    fanId: string,
    protection: Protection,
    correlationId: string,
    at: Date,
  ): Promise<void>;
  /** He stated an adult age himself (Charles, 27/10): confirmed by the policy, unless it already is or was taken back. */
  confirmAge(creatorId: string, fanId: string, correlationId: string, at: Date): Promise<void>;
}

/** The `fans` module behind the port; the policy is the author (`system`), the risks are the reason. */
export function createFanLimits(
  fans: Pick<FansModule, 'flags' | 'setFlag' | 'setFlagIfUnset' | 'clearFlag' | 'confirmDeclaredAge'>,
): FanLimits {
  return {
    flags: (creatorId, fanId) => fans.flags(CreatorIdSchema.parse(creatorId), FanIdSchema.parse(fanId)),
    async protect(creatorId, fanId, protection, correlationId, at) {
      const creator = CreatorIdSchema.parse(creatorId);
      const fan = FanIdSchema.parse(fanId);
      const reason = protection.because.join(', ').slice(0, 500);
      const command: { author: 'system'; correlationId: string; reason?: string } = {
        author: 'system',
        correlationId,
        ...(reason !== '' && { reason }),
      };
      if (protection.stopContact)
        await fans.setFlag(creator, fan, { flag: 'doNotContact', value: true }, command);
      if (protection.unconfirmAge) await fans.clearFlag(creator, fan, 'ageConfirmedAt', command);
      // A freeze a human set (operator, spending limit) keeps its reason: the policy only adds one where none is,
      // decided under the row lock so a freeze set from Suivi meanwhile is never overwritten.
      if (protection.freezeSales) {
        const value = { reason: 'money_trouble', since: at.toISOString() } satisfies FanFlags['salesFrozen'];
        await fans.setFlagIfUnset(creator, fan, { flag: 'salesFrozen', value }, command);
      }
    },
    async confirmAge(creatorId, fanId, correlationId, at) {
      await fans.confirmDeclaredAge(CreatorIdSchema.parse(creatorId), FanIdSchema.parse(fanId), at, {
        correlationId,
        reason: 'declared_adult_age',
      });
    },
  };
}
