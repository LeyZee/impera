import { useState, type JSX } from 'react';

import { Page, PageHeader, Panel, PanelSection } from '../shell/layout';

import { browserOf, EXTENSION_ZIP, isLocalCrm, type Browser } from './extension';

interface Steps {
  readonly title: string;
  readonly steps: readonly string[];
}

const STEPS: Record<Exclude<Browser, 'other'>, Steps> = {
  chrome: {
    title: 'Dans Chrome',
    steps: [
      'Télécharge le fichier ci-dessus, puis décompresse-le (clic droit, « Extraire tout ») dans un dossier que tu gardes, par exemple Documents › Impera.',
      'Tape chrome://extensions dans la barre d’adresse.',
      'Active « Mode développeur », en haut à droite.',
      'Clique « Charger l’extension non empaquetée » et choisis le dossier décompressé.',
      'Clique la pièce de puzzle à droite de la barre d’adresse, puis la punaise à côté d’Impera.',
    ],
  },
  edge: {
    title: 'Dans Edge',
    steps: [
      'Télécharge le fichier ci-dessus, puis décompresse-le (clic droit, « Extraire tout ») dans un dossier que tu gardes, par exemple Documents › Impera.',
      'Tape edge://extensions dans la barre d’adresse.',
      'Active « Mode développeur », dans la colonne de gauche.',
      'Clique « Charger l’extension décompressée » et choisis le dossier décompressé.',
      'Clique la pièce de puzzle à droite de la barre d’adresse, puis l’œil à côté d’Impera pour l’afficher dans la barre.',
    ],
  },
};

const LAST_STEP = 'Clique l’icône Impera : connecté au CRM, tu vois ton nom.';

/** The zip carries no CRM address (ADR 0067 § 4): away from localhost, the popup is told this CRM's once (ADR 0066 § 4). */
function AddressStep({ origin }: { readonly origin: string }): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'refused'>('idle');
  return (
    <li>
      <span className="nv-help-ext__address">
        <span>
          Clique l’icône Impera, puis « Changer l’adresse » : colle <code>{origin}</code>, « Enregistrer », et
          accepte l’autorisation que le navigateur demande pour ce site.
        </span>
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          aria-live="polite"
          onClick={() => {
            try {
              navigator.clipboard.writeText(origin).then(
                () => {
                  setState('copied');
                },
                () => {
                  setState('refused');
                },
              );
            } catch {
              setState('refused');
            }
          }}
        >
          {state === 'copied' ? 'Copiée' : state === 'refused' ? 'Copie-la à la main' : 'Copier l’adresse'}
        </button>
      </span>
    </li>
  );
}

interface Offer {
  readonly title: string;
  readonly text: string;
  readonly soon?: true;
}

const ACCOUNT: Offer = {
  title: 'Ton compte, d’un clic',
  text: 'Elle reprend ta connexion au CRM : rien à retaper, ni mot de passe ni code.',
};
const SHORTCUTS: Offer = {
  title: 'Tes raccourcis',
  text: 'Les pages du CRM qui te servent, depuis n’importe quel onglet.',
};
const FAN: Offer = {
  title: 'Le fan sous les yeux',
  text: 'Sur Reveal, à côté de la conversation ouverte : ce qu’il faut savoir de ce fan, sans changer d’onglet.',
  soon: true,
};
const WATCH: Offer = {
  title: 'La veille Instagram',
  text: 'Tu scrolles comme d’habitude, elle note les posts qui marchent. Jamais un message, jamais un clic à ta place.',
  soon: true,
};

/** What the page promises: the trend watch only to those who do it (ADR 0060), Reveal to everyone of the team. */
export function offersFor(watches: boolean): readonly Offer[] {
  return watches ? [ACCOUNT, SHORTCUTS, FAN, WATCH] : [ACCOUNT, SHORTCUTS, FAN];
}

/** /aide/extension (ADR 0067): what the extension offers, then the steps for Chrome and Edge, this browser's first. */
export function ExtensionPage({ watches }: { readonly watches: boolean }): JSX.Element {
  const browser = browserOf(navigator.userAgent);
  const origin = window.location.origin;
  const order: readonly Exclude<Browser, 'other'>[] =
    browser === 'edge' ? ['edge', 'chrome'] : ['chrome', 'edge'];
  return (
    <Page>
      <PageHeader
        title="Installer l’extension"
        lead="Deux minutes, une seule fois : Impera s’ouvre ensuite d’un clic dans la barre de ton navigateur, déjà connectée."
      />
      <div className="nv-help-install nv-help-ext">
        {browser === 'other' ? (
          <Panel>
            <PanelSection className="nv-help-install__done">
              <p>L’extension marche sur ordinateur, dans Chrome ou Edge. Ouvre cette page depuis ton PC.</p>
            </PanelSection>
          </Panel>
        ) : null}
        <Panel title="À quoi elle sert">
          <PanelSection className="nv-help-ext__intro">
            <figure className="nv-help-ext__shot">
              <img
                className="nv-help-ext__shot--night"
                src="/help/extension-popup-nuit.webp"
                width={348}
                height={415}
                alt="L’extension ouverte : le bonjour, le compte connecté, quatre raccourcis et « Ouvrir le CRM »."
              />
              <img
                className="nv-help-ext__shot--day"
                src="/help/extension-popup-jour.webp"
                width={348}
                height={415}
                alt="L’extension ouverte : le bonjour, le compte connecté, quatre raccourcis et « Ouvrir le CRM »."
              />
            </figure>
            <ul className="nv-help-ext__offers">
              {offersFor(watches).map((offer) => (
                <li key={offer.title} className="nv-help-ext__offer">
                  <span className="nv-help-ext__offer-head">
                    <strong>{offer.title}</strong>
                    {offer.soon === true ? <span className="nv-help-ext__soon">Bientôt</span> : null}
                  </span>
                  <span>{offer.text}</span>
                </li>
              ))}
            </ul>
          </PanelSection>
        </Panel>
        <Panel>
          <PanelSection className="nv-help-install__now">
            <p>
              {import.meta.env.DEV
                ? 'Sur ce PC de développement, le fichier n’est pas servi : charge directement le dossier apps/extension/.output/chrome-mv3.'
                : 'La dernière version, la même pour toute l’équipe.'}
            </p>
            <a className="nv-btn nv-btn--neon" href={EXTENSION_ZIP} download="impera-extension.zip">
              Télécharger l’extension
            </a>
          </PanelSection>
        </Panel>
        <div className="nv-help-install__cards">
          {order.map((key) => (
            <Panel key={key} title={STEPS[key].title}>
              <PanelSection>
                <ol className="nv-help-install__steps">
                  {STEPS[key].steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                  {isLocalCrm(origin) ? null : <AddressStep origin={origin} />}
                  <li>{LAST_STEP}</li>
                </ol>
              </PanelSection>
            </Panel>
          ))}
        </div>
        <Panel title="Quand une nouvelle version sort">
          <PanelSection>
            <ol className="nv-help-install__steps">
              <li>
                Télécharge de nouveau le fichier et décompresse-le dans le même dossier, en remplaçant
                l’ancien.
              </li>
              <li>Dans la page des extensions, clique la flèche ↻ de la carte Impera.</li>
            </ol>
          </PanelSection>
        </Panel>
        <p className="nv-help-install__note">
          Au démarrage, le navigateur peut rappeler qu’une extension en mode développeur est active : c’est
          normal, garde-la. Elle n’a accès qu’à Reveal et au CRM ; à l’ouverture, elle regarde seulement
          l’adresse de l’onglet.
        </p>
      </div>
    </Page>
  );
}
