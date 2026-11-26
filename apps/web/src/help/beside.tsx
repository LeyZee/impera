import { railKindOf, type Me } from '@impera/contracts';
import { createContext, useContext, useMemo, type JSX, type ReactNode } from 'react';

import { french, Guide } from './Guide';
import { HELP, type HelpAudience, type HelpGuide } from './guides';

/**
 * The person's colour, the only one of the help (choix de Charles du 21/11) : or pour le propriétaire, bleu pour le
 * manager, violet pour le chatteur, rose pour la modèle, taken from the content hues so both themes hold.
 */
export const AUDIENCE_COLOUR: Readonly<Record<HelpAudience, string>> = {
  owner: 'var(--nv-content-6)',
  manager: 'var(--nv-content-1)',
  chatter: 'var(--nv-content-5)',
  creator: 'var(--nv-content-2)',
};

/** Whose guide a person reads: the owner's, a creator's, a manager's; anyone else on the team reads the chatter's. */
export function audienceOf(user: Me): HelpAudience {
  const kind = railKindOf(user);
  return kind === 'owner' || kind === 'creator' || kind === 'manager' ? kind : 'chatter';
}

/**
 * The guides folded beside their screen (demande de Charles du 21/11 : « petits guides repliés à côté du geste »), by
 * the screen's address and by whose guide it is. Only screens that are on main, only a guide whose gesture is done on
 * that very screen, and not where the screen already explains it (Réglages › Sauvegardes has its own « Comment se joue un
 * essai »); the same guide stays whole in Moi › Aide (Réglages › Aide for the owner).
 */
export const GUIDES_BESIDE: Readonly<Record<string, Partial<Record<HelpAudience, readonly string[]>>>> = {
  '/': { owner: ['choisir-le-mode-de-l-ia'] },
  '/creatrices': { owner: ['mettre-une-creatrice-en-route'] },
  '/suivi/alertes': { owner: ['une-alerte-urgente'], manager: ['une-alerte'] },
  '/equipe/planning': { manager: ['construire-le-planning'] },
  '/equipe/rapports': { manager: ['valider-les-rapports-de-fin-de-shift'] },
  '/equipe/membres': { owner: ['ajouter-un-membre'] },
  '/equipe/annonces': { manager: ['une-annonce-a-l-equipe'] },
  '/paie/quinzaine': { owner: ['cloturer-la-quinzaine'] },
  '/paie/primes-malus': { manager: ['primes-et-malus'] },
  '/entrainer/playground': { manager: ['corriger-l-ia'] },

  '/reglages/consommation-ia': { owner: ['surveiller-le-cout-de-l-ia'] },
  '/reglages/securite': { owner: ['ton-code-a-deux-facteurs'] },
  '/planning': { chatter: ['echanger-un-shift', 'demander-un-conge', 'tes-shifts-dans-ton-calendrier'] },
  '/commissions': { chatter: ['ta-commission-et-tes-factures'] },
  '/contenu': { creator: ['deposer-ton-contenu'] },
  '/moi/trophees': { chatter: ['ton-rang-et-ta-progression'] },
  '/moi/securite': { manager: ['ton-code-a-deux-facteurs'], chatter: ['ton-code-a-deux-facteurs'] },
  '/moi/liens': { creator: ['tes-liens'] },
  '/moi/persona': { creator: ['ta-persona'] },
};

interface Beside {
  readonly guides: readonly HelpGuide[];
  readonly colour: string;
}

/** The guides of the screen on display; read by the page's header, which folds them under its title. */
const BesideContext = createContext<Beside | null>(null);

/** The guides `audience` reads beside the screen at `pathname`, in the order given. */
export function guidesBeside(pathname: string, audience: HelpAudience): readonly HelpGuide[] {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname;
  const ids = GUIDES_BESIDE[path]?.[audience] ?? [];
  return ids.flatMap((id) => HELP[audience].guides.filter((guide) => guide.id === id));
}

export function GuidesBesideProvider({
  user,
  pathname,
  children,
}: {
  user: Me;
  pathname: string;
  children: ReactNode;
}): JSX.Element {
  const audience = audienceOf(user);
  const value = useMemo<Beside | null>(() => {
    const guides = guidesBeside(pathname, audience);
    return guides.length === 0 ? null : { guides, colour: AUDIENCE_COLOUR[audience] };
  }, [pathname, audience]);
  return <BesideContext.Provider value={value}>{children}</BesideContext.Provider>;
}

/**
 * Under a page's title: one quiet line, « Pas à pas », that names the screen's guides; opened, the guides, each
 * folded. A screen read every day keeps its content where it was. Nothing outside the shell or on a screen without one.
 */
export function GuidesBeside(): JSX.Element | null {
  const beside = useContext(BesideContext);
  if (beside === null) return null;
  return (
    <details className="nv-disclosure nv-page__guides">
      <summary>
        <span className="nv-disclosure__title">Pas à pas</span>
        <span className="nv-disclosure__sum">
          {beside.guides.map((guide) => french(guide.title)).join(' · ')}
        </span>
      </summary>
      <div className="nv-disclosure__body nv-page__guides-list">
        {beside.guides.map((guide) => (
          <Guide key={guide.id} guide={guide} colour={beside.colour} />
        ))}
      </div>
    </details>
  );
}
