import type { AgencyLogo, BillingSettingsView, UpdateBillingSettingsBody, UserId } from '@nirvana/contracts';

import { agencyLogoVerdict, logoSidesFit, type PngReading, type PngSize } from '../domain/agency-logo';
import { AgencyLogoInvalid, AgencyLogoNotFound } from '../domain/errors';
import type { Actor, PayrollBillingSettingsStore } from '../domain/ports';

/** Reads a file as a PNG, decoding its pixels only when `decodable` allows it (`infra/png.ts`). */
export type PngReader = (bytes: Uint8Array, decodable: (size: PngSize) => boolean) => PngReading;

/**
 * Réglages › Facturation (EQ-06), the owner's alone: the agency as each invoice prints it, the designation of the
 * service, the payment terms and the due delay, the close of the fiscal year, the logo. Until they are saved, no
 * invoice is issued (`agency_missing`); an invoice issued before a change keeps its own copy and its PDF.
 */
export interface PayrollBillingSettings {
  read(userId: UserId): Promise<BillingSettingsView>;
  update(actor: Actor, body: UpdateBillingSettingsBody): Promise<BillingSettingsView>;
  /**
   * Checks the file and keeps it (`agencyLogoVerdict`): a PNG of at most 512 KB, whole, of sides in bounds, with a
   * transparent pixel; refused with its reason (`agency_logo_invalid`). The settings name it only once saved.
   */
  addLogo(actor: Actor, bytes: Uint8Array): Promise<{ logo: AgencyLogo; created: boolean }>;
  /** A logo's bytes, for the screen to show it; `agency_logo_not_found` when none has this fingerprint. */
  logo(userId: UserId, sha256: string): Promise<Uint8Array>;
}

export function createPayrollBillingSettings(
  store: PayrollBillingSettingsStore,
  readPng: PngReader,
): PayrollBillingSettings {
  return {
    read: (userId) => store.read(userId),
    update: (actor, body) => store.update(actor, body),
    addLogo: (actor, bytes) => {
      const verdict = agencyLogoVerdict(bytes.length, () => readPng(bytes, logoSidesFit));
      if (verdict.kind === 'refused') return Promise.reject(new AgencyLogoInvalid(verdict.reason));
      return store.addLogo(actor, bytes, verdict.size);
    },
    logo: async (userId, sha256) => {
      const bytes = await store.logoBytes(userId, sha256);
      if (bytes === null) throw new AgencyLogoNotFound();
      return bytes;
    },
  };
}
