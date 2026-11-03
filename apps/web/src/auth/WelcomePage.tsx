import type { JSX } from 'react';

import { LinkPage, type LinkPageCopy, type LinkPageProps } from './LinkPage';

import { countryFlag, countryName } from '@/lib/country';

const COPY: LinkPageCopy = {
  // A creator's own account has no country on file (CR-02): her space says what it is instead.
  eyebrow: (preview) =>
    preview.account === 'creator'
      ? 'Ton espace créatrice'
      : `${countryFlag(preview.country)} ${countryName(preview.country)}`,
  title: (preview) => `Bienvenue, ${preview.displayName}`,
  page: 'Bienvenue',
  lead: 'Choisis ton mot de passe. Avec ton e-mail, il t’ouvre ton espace, sur ton téléphone comme sur un ordinateur.',
  passwordLabel: 'Mot de passe',
  submit: 'Entrer',
  footnote: (preview) =>
    preview.account === 'creator'
      ? 'Ton nom est faux ? Dis-le à ton agence.'
      : 'Ton nom ou ton pays est faux ? Dis-le à ton responsable.',
};

/** `/bienvenue#t=…` (EQ-10): a new member's first access, from the link the owner shared. */
export function WelcomePage(props: LinkPageProps): JSX.Element {
  return <LinkPage copy={COPY} {...props} />;
}
