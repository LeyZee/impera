import type { JSX } from 'react';

import { LinkPage, type LinkPageProps } from './LinkPage';

/** `/bienvenue#t=…` (EQ-10): a new member's first access, from the link the owner shared. */
export function WelcomePage(props: LinkPageProps): JSX.Element {
  return <LinkPage purpose="invitation" {...props} />;
}
