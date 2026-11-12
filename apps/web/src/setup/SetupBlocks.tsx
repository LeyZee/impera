import { isSetupComplete, type CreatorId, type TeamMemberId } from '@impera/contracts';
import type { JSX } from 'react';

import { SetupCard } from './SetupCard';
import { useCreatorSetups, useMemberSetups } from './api';
import { creatorLines, memberLines } from './model';

/** Her « Mise en route » on top of her sheet, the owner's; gone once all is done, or while the read fails. */
export function CreatorSetupBlock({ creatorId }: { creatorId: CreatorId }): JSX.Element | null {
  const setups = useCreatorSetups(true);
  const setup = setups.data?.find((one) => one.creatorId === creatorId);
  if (setup === undefined || isSetupComplete(setup.steps)) return null;
  return <SetupCard lines={creatorLines(creatorId, setup.steps)} label="Mise en route de la créatrice" />;
}

/**
 * His « Mise en route » on his sheet in Équipe › Membres: the owner's, and an active manager's for a chatter (without
 * his invoicing, left out by the server); gone once all is done.
 */
export function MemberSetupBlock({ memberId }: { memberId: TeamMemberId }): JSX.Element | null {
  const setups = useMemberSetups(true);
  const setup = setups.data?.find((one) => one.memberId === memberId);
  if (setup === undefined || isSetupComplete(setup.steps)) return null;
  return <SetupCard lines={memberLines(memberId, setup.steps)} label="Mise en route du membre" />;
}
