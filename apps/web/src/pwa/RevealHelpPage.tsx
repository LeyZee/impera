import type { JSX } from 'react';

import { Page, PageHeader, Panel, PanelSection } from '../shell/layout';

/** The steps of docs/runbooks/session-expired.md, in the owner's words (P2-01). */
const STEPS: readonly string[] = [
  'Sur ton PC, ouvre Reveal dans Chrome ou Edge, là où l’extension Impera est installée.',
  'Connecte-toi avec le compte du membre d’équipe « bot », jamais avec le tien ni celui d’un chatteur : les messages de l’agent partent sous ce membre.',
  'Ouvre la messagerie de Reveal et choisis la créatrice du compte à reconnecter.',
  'Clique l’icône Impera : sous « Session du connecteur », clique « Synchroniser » sur la ligne de son compte.',
  'La ligne passe à « Session valide » : le connecteur reprend seul et rattrape les messages manqués.',
];

const TROUBLES: readonly { readonly title: string; readonly text: string }[] = [
  {
    title: 'Aucune session lue',
    text: 'L’onglet n’a rien demandé à Reveal pendant 30 secondes : recharge la messagerie, puis réessaie.',
  },
  {
    title: 'Une autre créatrice que ce compte',
    text: 'L’onglet montre une autre créatrice que celle du compte : choisis la bonne dans Reveal, puis réessaie.',
  },
  {
    title: 'La session expire sans arrêt',
    text: 'Reveal coupe peut-être la session quand le membre « bot » se connecte ailleurs : n’ouvre ce compte que sur ce PC.',
  },
];

/**
 * /aide/reveal (P2-01, réservée le 30/10): reconnect Reveal when its session expired. The owner's alone, like the
 * « Sync » itself (reveal-connector-spec.md § 2).
 */
export function RevealHelpPage(): JSX.Element {
  return (
    <Page>
      <PageHeader
        title="Reconnecter Reveal"
        lead="Quand la session Reveal expire, l’agent s’arrête. Une minute depuis ton PC suffit à le relancer."
      />
      <div className="nv-help-install">
        <Panel title="Synchroniser la session">
          <PanelSection>
            <ol className="nv-help-install__steps">
              {STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </PanelSection>
        </Panel>
        <Panel title="Si ça ne marche pas">
          <PanelSection>
            <ul className="nv-help-ext__offers">
              {TROUBLES.map((trouble) => (
                <li key={trouble.title} className="nv-help-ext__offer">
                  <strong>{trouble.title}</strong>
                  <span>{trouble.text}</span>
                </li>
              ))}
            </ul>
          </PanelSection>
        </Panel>
        <p className="nv-help-install__note">
          L’extension lit la session dans l’onglet Reveal, l’envoie chiffrée au CRM, puis l’oublie : rien ne
          reste dans le navigateur, et elle n’est jamais affichée.
        </p>
      </div>
    </Page>
  );
}
