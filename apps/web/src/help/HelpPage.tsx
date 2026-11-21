import { railKindOf, type Me } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { Guide, withKeys } from './Guide';
import { HELP, type HelpAudience } from './guides';

import { playsTheGame } from '@/rewards/api';
import { MeNav } from '@/screens/me/MeNav';
import { NavIcon, type NavIconName } from '@/shell/NavIcon';
import { Page, PageHeader } from '@/shell/layout';

import './help.css';

/**
 * The person's colour, the only one of the page (choix de Charles du 21/11) : or pour le propriétaire, bleu pour le
 * manager, violet pour le chatteur, rose pour la modèle, taken from the content hues so both themes hold.
 */
export const AUDIENCE_COLOUR: Readonly<Record<HelpAudience, string>> = {
  owner: 'var(--nv-content-6)',
  manager: 'var(--nv-content-1)',
  chatter: 'var(--nv-content-5)',
  creator: 'var(--nv-content-2)',
};

/** The pages of help that already exist, each for whom it serves. */
const PAGES: readonly {
  readonly to: '/aide/installer' | '/aide/extension' | '/aide/reveal' | '/notifications';
  readonly icon: NavIconName;
  readonly label: string;
  readonly for: readonly HelpAudience[];
}[] = [
  {
    to: '/aide/installer',
    icon: 'phone',
    label: 'Installer Impera',
    for: ['owner', 'manager', 'chatter', 'creator'],
  },
  {
    to: '/notifications',
    icon: 'bell',
    label: 'Régler mes notifications',
    for: ['owner', 'manager', 'chatter', 'creator'],
  },
  {
    to: '/aide/extension',
    icon: 'puzzle',
    label: 'Installer l’extension',
    for: ['owner', 'manager', 'chatter'],
  },
  { to: '/aide/reveal', icon: 'compass', label: 'Reconnecter Reveal', for: ['owner'] },
];

/**
 * The person's guide: the answer first (what this space is for, the day in three beats), then the gestures that need a
 * guide, each folded, then the pages of help and the real questions. Inside Moi › Aide, or alone in Réglages › Aide for
 * the owner, whose sections are bodies under Réglages' own header.
 */
export function HelpContent({ audience }: { audience: HelpAudience }): JSX.Element {
  const book = HELP[audience];
  const colour = AUDIENCE_COLOUR[audience];
  return (
    <div className="hp__stack" style={{ '--_c': colour }}>
      <section className="nv-plate nv-plate--pad hp__essential" aria-labelledby="hp-essential">
        <p className="hp__kicker" id="hp-essential">
          <i aria-hidden="true" />
          L’essentiel
        </p>
        <p className="hp__lead">{book.lead}</p>
        <ol className="hp__day">
          {book.day.map((beat) => (
            <li key={beat.title}>
              <b>{beat.title}</b>
              {beat.text}
            </li>
          ))}
        </ol>
      </section>

      <section className="hp__section" aria-labelledby="hp-guides">
        <div className="hp__head">
          <h2 className="nv-h2" id="hp-guides">
            Les gestes qui demandent un guide
          </h2>
          <span className="hp__count">{book.guides.length} guides</span>
        </div>
        <nav className="hp__toc" aria-label="Aller à un guide">
          {book.guides.map((guide) => (
            <a
              key={guide.id}
              href={`#guide-${guide.id}`}
              onClick={(event) => {
                const target = document.getElementById(`guide-${guide.id}`);
                if (!(target instanceof HTMLDetailsElement)) return;
                event.preventDefault();
                target.open = true;
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <i aria-hidden="true" />
              {guide.title}
            </a>
          ))}
        </nav>
        <div className="hp__guides">
          {book.guides.map((guide, index) => (
            <Guide key={guide.id} guide={guide} colour={colour} index={index} open={index === 0} />
          ))}
        </div>
      </section>

      <section className="nv-plate nv-plate--pad hp__section hp__pages" aria-labelledby="hp-pages">
        <h2 className="nv-h2" id="hp-pages">
          Les pages d’aide
        </h2>
        <div className="hp__links">
          {PAGES.filter((page) => page.for.includes(audience)).map((page) => (
            <Link key={page.to} to={page.to} className="hp__link">
              <span className="hp__link-icon" aria-hidden="true">
                <NavIcon name={page.icon} />
              </span>
              {page.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="nv-plate nv-plate--pad hp__section" aria-labelledby="hp-faq">
        <div className="hp__head">
          <h2 className="nv-h2" id="hp-faq">
            Questions fréquentes
          </h2>
          <span className="hp__count">{book.faq.length}</span>
        </div>
        <div className="hp__faq">
          {book.faq.map((item) => (
            <details key={item.q} className="nv-disclosure">
              <summary>
                <span className="hp__q">{item.q}</span>
              </summary>
              <div className="nv-disclosure__body">
                <p className="hp__a">{withKeys(item.a)}</p>
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Moi › Aide: a chatter's, a manager's or a creator's guide, under Moi's tabs. */
export function HelpPage({ user }: { user: Me }): JSX.Element {
  const kind = railKindOf(user);
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Moi"
        title="Aide"
        lead="Ce qu’il faut savoir pour ton travail, et les gestes difficiles pas à pas."
        tabs={
          <MeNav
            manager={user.teamScope === 'agency'}
            creator={user.role === 'creator'}
            trophies={playsTheGame(user)}
          />
        }
      />
      <HelpContent audience={kind === 'creator' || kind === 'manager' ? kind : 'chatter'} />
    </Page>
  );
}
