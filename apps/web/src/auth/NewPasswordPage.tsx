import type { JSX } from 'react';

import { LinkPage, type LinkPageProps } from './LinkPage';

/** `/nouveau-mot-de-passe#t=…` (EQ-10): a new password without e-mail, from the link the owner shared. */
export function NewPasswordPage(props: LinkPageProps): JSX.Element {
  return <LinkPage purpose="reset" {...props} />;
}
