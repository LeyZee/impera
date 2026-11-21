// @vitest-environment jsdom
import { TeamMemberSchema } from '@impera/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Avatar } from './parts';

afterEach(cleanup);

/* An invented member: no real data. */
const member = (displayName: string) =>
  TeamMemberSchema.parse({
    id: '0199f2a0-0000-7000-8000-000000000091',
    userId: '0199f2a0-0000-7000-8000-000000000191',
    email: 'membre@example.test',
    firstName: 'Membre',
    lastName: 'Exemple',
    displayName,
    teamRole: 'chatter',
    status: 'active',
    country: 'BJ',
    timeZone: 'Africa/Porto-Novo',
    color: null,
    joinedOn: '2026-10-01',
    creatorIds: [],
    commission: null,
    invitationPending: false,
    invitationExpiresAt: null,
  });

describe('Avatar', () => {
  it('keeps an emoji or an accented letter whole in the initials', () => {
    const { container, rerender } = render(<Avatar member={member('💋 Théo')} />);
    expect(container.textContent).toBe('💋T');
    rerender(<Avatar member={member('élodie')} />);
    expect(container.textContent).toBe('É');
  });

  it('tells apart members whose names share a first word, as Équipe › Comptes Reveal does (GES-21)', () => {
    const { container, rerender } = render(<Avatar member={member('Chatteur Un')} />);
    expect(container.textContent).toBe('CU');
    rerender(<Avatar member={member('Chatteur Deux')} />);
    expect(container.textContent).toBe('CD');
  });
});
