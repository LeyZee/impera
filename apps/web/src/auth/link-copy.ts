import type { InvitationLinkPreview, InvitationLinkPurpose } from '@impera/contracts';

import { countryFlag, countryName } from '@/lib/country';

/** What tells the two pages apart; the rest is the same walk. */
export interface LinkPageCopy {
  /** Above the title: what the member checks of his record (EQ-10 « vérifier son nom et son pays »). */
  readonly eyebrow?: (preview: InvitationLinkPreview) => string;
  readonly title: (preview: InvitationLinkPreview) => string;
  /** The browser tab's name for the page, before the link is read. */
  readonly page: string;
  readonly lead: string;
  readonly passwordLabel: string;
  readonly submit: string;
  /** Under the button, faint. */
  readonly footnote?: (preview: InvitationLinkPreview) => string;
}

const WELCOME: LinkPageCopy = {
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

const NEW_PASSWORD: LinkPageCopy = {
  title: () => 'Nouveau mot de passe',
  page: 'Nouveau mot de passe',
  lead: 'Choisis-en un nouveau. Tes autres appareils seront déconnectés.',
  passwordLabel: 'Nouveau mot de passe',
  submit: 'Enregistrer',
};

/**
 * The words of each page, picked by what the link is for once it is read, not by the address it was opened at: an
 * invitation pasted on the new-password page still says « Bienvenue » (recette SEC-10).
 */
export const LINK_COPIES: Readonly<Record<InvitationLinkPurpose, LinkPageCopy>> = {
  invitation: WELCOME,
  reset: NEW_PASSWORD,
};
