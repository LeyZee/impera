import { KYC_ASKABLE, KycSlotSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { askableOnly, askableSlots } from '../kyc';

describe('what she may ask him (ADR 0085 § 2)', () => {
  it('asks six slots: every canvas line but `desires`', () => {
    expect(KYC_ASKABLE).toEqual(['first_name', 'location', 'age', 'job', 'hobbies', 'situation']);
    expect(askableSlots(KycSlotSchema.options)).toEqual([...KYC_ASKABLE]);
    expect(askableSlots(['desires', 'job', 'first_name'])).toEqual(['job', 'first_name']);
  });

  it('keeps in `kycMissing` only what she may ask, by code or by line, whatever its case', () => {
    expect(
      askableOnly({ kycMissing: ['Envies', ' prénom ', 'LOCATION', 'payday', 'Âge'] }).kycMissing,
    ).toEqual([' prénom ', 'LOCATION', 'Âge']);
  });
});
