import type { JSX } from 'react';

import { LinkPage, type LinkPageCopy, type LinkPageProps } from './LinkPage';

const COPY: LinkPageCopy = {
  title: () => 'Nouveau mot de passe',
  page: 'Nouveau mot de passe',
  lead: 'Choisis-en un nouveau. Tes autres appareils seront déconnectés.',
  passwordLabel: 'Nouveau mot de passe',
  submit: 'Enregistrer',
};

/** `/nouveau-mot-de-passe#t=…` (EQ-10): a new password without e-mail, from the link the owner shared. */
export function NewPasswordPage(props: LinkPageProps): JSX.Element {
  return <LinkPage copy={COPY} {...props} />;
}
