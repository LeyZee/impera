import { Link } from '@tanstack/react-router';
import { useEffect, useState, type JSX } from 'react';

import { OffRailBack } from '../shell/OffRailBack';
import { Page, PageHeader, Panel, PanelSection } from '../shell/layout';
import type { securityPathOf } from '../shell/nav';

import { browserOf, EXTENSION_ZIP, extensionKnowsThisCrm, type Browser } from './extension';

type SecurityPath = ReturnType<typeof securityPathOf>;

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

/**
 * « Relier l’extension », one step with one word (recette navigation du 27/11, CH-01): his account, by the code of
 * Sécurité pasted in the extension, and before it, on a CRM whose extension does not know its address, this CRM itself
 * (ADR 0067, amendement du 19/11), nothing to type. Named in the order he does them, so he knows when he is done.
 */
function LinkSteps({
  knowsCrm,
  security,
}: {
  readonly knowsCrm: boolean;
  readonly security: SecurityPath;
}): JSX.Element {
  return (
    <Panel title="Relier l’extension">
      <PanelSection>
        <ol className="nv-help-install__steps">
          {knowsCrm ? null : (
            <li>
              <span className="nv-help-ext__address">
                <span>À ce CRM, sans rien taper : un clic ici, puis sur l’icône Impera.</span>
                <Link to="/extension/lier" className="nv-btn nv-btn--soft nv-btn--sm">
                  Relier l’extension à ce CRM
                </Link>
              </span>
            </li>
          )}
          <li>
            <span className="nv-help-ext__address">
              <span>
                {/* « À ton compte » only beside « À ce CRM »: alone, the step says where to go. */}
                {knowsCrm ? 'Dans' : 'À ton compte : dans'} Sécurité, «&nbsp;Relier l’extension&nbsp;», puis
                «&nbsp;Copier le code&nbsp;».
              </span>
              <Link to={security} className="nv-btn nv-btn--soft nv-btn--sm">
                Ouvrir Sécurité
              </Link>
            </span>
          </li>
          <li>
            Ouvre Reveal, clique l’icône Impera et colle le code dans la carte «&nbsp;Copilote&nbsp;», puis
            «&nbsp;Relier&nbsp;». Une seule fois par navigateur.
          </li>
          <li>C’est fait quand la carte «&nbsp;Copilote&nbsp;» ne dit plus «&nbsp;À relier&nbsp;».</li>
        </ol>
      </PanelSection>
    </Panel>
  );
}

interface Offer {
  readonly title: string;
  readonly text: string;
}

/** What the extension does today; what comes later is one line at the foot of the page (recette 05/11, PRO-24). */
const OFFERS: readonly Offer[] = [
  {
    title: 'Ton compte, d’un clic',
    text: 'Elle reprend ta connexion au CRM : rien à retaper, ni mot de passe ni code.',
  },
  {
    title: 'Tes raccourcis',
    text: 'Les pages du CRM qui te servent, depuis n’importe quel onglet.',
  },
  {
    title: 'Le copilote sur Reveal',
    text: 'À côté de la conversation ouverte : la fiche du fan et le brouillon, prêt à copier pour Reveal.',
  },
];

/** The trend watch, only to those it belongs to (ADR 0060). */
const WATCH: Offer = {
  title: 'La veille Instagram',
  text: 'Pendant que tu regardes Instagram, elle relève les posts qui marchent pour les idées du matin.',
};

/** The copilot, which exists (recette du 16/11, EXT-06): how to open it, and its three keys; linking is its own panel. */
const COPILOT_STEPS: readonly string[] = [
  'Ouvre une conversation dans Reveal, clique l’icône Impera, puis « Ouvrir le copilote » : il s’ouvre sur le côté et suit la conversation ouverte, sans clic.',
  'Trois touches : A copie le brouillon pour Reveal, où tu le colles et l’envoies ; E le retouche ; R le refuse, avec une raison.',
];

/**
 * Whether this CRM serves the extension's file (V-CHA, recette du 16/11): a link to a file that is not there downloads
 * an error page. A server that answers with a page (its own fallback) does not serve it either.
 */
function useZipServed(): 'checking' | 'served' | 'missing' {
  const [state, setState] = useState<'checking' | 'served' | 'missing'>('checking');
  useEffect(() => {
    let live = true;
    fetch(EXTENSION_ZIP, { method: 'HEAD' }).then(
      (response) => {
        const page = (response.headers.get('content-type') ?? '').includes('text/html');
        if (live) setState(response.ok && !page ? 'served' : 'missing');
      },
      () => {
        if (live) setState('missing');
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** /aide/extension (ADR 0067): what the extension offers, then the steps for Chrome and Edge, this browser's first. */
export function ExtensionPage({
  watches,
  security,
}: {
  readonly watches: boolean;
  /** His own Sécurité, where the code is (`securityPathOf`). */
  readonly security: SecurityPath;
}): JSX.Element {
  const browser = browserOf(navigator.userAgent);
  const zip = useZipServed();
  const offers = watches ? [...OFFERS, WATCH] : OFFERS;
  const linked = extensionKnowsThisCrm();
  const order: readonly Exclude<Browser, 'other'>[] =
    browser === 'edge' ? ['edge', 'chrome'] : ['chrome', 'edge'];
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={<OffRailBack />}
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
                height={427}
                alt="L’extension ouverte : le bonjour, le compte connecté, quatre raccourcis et « Ouvrir le CRM »."
              />
              <img
                className="nv-help-ext__shot--day"
                src="/help/extension-popup-jour.webp"
                width={348}
                height={427}
                alt="L’extension ouverte : le bonjour, le compte connecté, quatre raccourcis et « Ouvrir le CRM »."
              />
            </figure>
            <ul className="nv-help-ext__offers">
              {offers.map((offer) => (
                <li key={offer.title} className="nv-help-ext__offer">
                  <strong>{offer.title}</strong>
                  <span>{offer.text}</span>
                </li>
              ))}
            </ul>
          </PanelSection>
        </Panel>
        <Panel>
          <PanelSection className="nv-help-install__now">
            <p>
              {zip === 'served'
                ? 'La dernière version, la même pour toute l’équipe.'
                : zip === 'checking'
                  ? 'Un instant…'
                  : import.meta.env.DEV
                    ? 'Sur ce PC de développement, le fichier n’est pas servi : charge directement le dossier apps/extension/.output/chrome-mv3.'
                    : 'Le fichier n’est pas encore en ligne sur ce CRM : demande-le à ton responsable.'}
            </p>
            {zip === 'served' ? (
              <a className="nv-btn nv-btn--neon" href={EXTENSION_ZIP} download="impera-extension.zip">
                Télécharger l’extension
              </a>
            ) : null}
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
                  {/* Built for this CRM, it is already connected; otherwise « Relier l’extension » comes first. */}
                  {linked ? <li>Clique sur l’icône Impera : elle affiche ton nom.</li> : null}
                </ol>
              </PanelSection>
            </Panel>
          ))}
        </div>
        {/* A hosted build knows this CRM from the install: no step that would lead nowhere (ADR 0067). */}
        <LinkSteps knowsCrm={linked} security={security} />
        <Panel title="Le copilote sur Reveal">
          <PanelSection>
            <ol className="nv-help-install__steps">
              {COPILOT_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </PanelSection>
        </Panel>
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
