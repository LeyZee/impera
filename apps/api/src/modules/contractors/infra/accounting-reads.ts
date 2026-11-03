import { eq, inArray, schema, type Transaction } from '@impera/db';

const { billingSettings, contractorProfiles, teamMembers } = schema;

/** A contractor's file as the exports read it, with the country of their member's card. */
export interface ProfileForAccounting {
  readonly profile: typeof contractorProfiles.$inferSelect;
  readonly country: (typeof teamMembers.$inferSelect)['country'];
}

/**
 * What the accountant's exports read of the contractors' file (ADR 0047 § 1, ARC-07), in the export's transaction
 * (`withMember`, the owner): the accounts of the journal and each contractor's file as it stands today. The file alone
 * reads its tables.
 */
export const contractorReadsForAccounting = {
  /** The accounts and journals the accountant gave, as stored (`null` until the settings are saved). */
  accounts: async (tx: Transaction): Promise<unknown> => {
    const [settings] = await tx
      .select({ accounts: billingSettings.accounts })
      .from(billingSettings)
      .where(eq(billingSettings.id, 1));
    return settings?.accounts ?? null;
  },

  /** Each of these members' file, with the country of their member's card. */
  profilesOf: (tx: Transaction, memberIds: readonly string[]): Promise<ProfileForAccounting[]> =>
    tx
      .select({ profile: contractorProfiles, country: teamMembers.country })
      .from(contractorProfiles)
      .innerJoin(teamMembers, eq(teamMembers.id, contractorProfiles.memberId))
      .where(inArray(contractorProfiles.memberId, [...memberIds])),
};
