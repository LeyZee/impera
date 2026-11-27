import type { Me } from '@impera/contracts';
import { useQuery } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';

import { PublicBrand } from './PublicBrand';
import './first-welcome.css';

import { useCreators } from '@/creators/api';
import { useMyShifts } from '@/scheduling/api';
import { swapShiftLine } from '@/scheduling/model';
import { readerZone } from '@/scheduling/time';
import { fetchOwnPasskeys } from '@/security/api';

/**
 * The welcome of a first sign-in (recette 27/11, P1, maquette validée par Charles le 27/11): shown once, right after
 * the backup codes and the offer of Face ID, before the app. One page per role: the model's three settings of a minute,
 * the chatter's three steps before his first shift, the manager's places to look and what stays the owner's. Every
 * step opens its own page; « plus tard » opens the app, and what is not done waits in « À faire » or in Réglages.
 */
export type WelcomeRole = 'creator' | 'chatter' | 'manager';

/** Who gets a welcome: the owner sets the agency up himself and has none. */
export function welcomeRoleOf(user: Me): WelcomeRole | null {
  if (user.role === 'creator') return 'creator';
  if (user.role !== 'operator') return null;
  return user.team?.role === 'manager' ? 'manager' : 'chatter';
}

const firstNameOf = (user: Me): string => user.name.trim().split(/\s+/u)[0] ?? '';

export function FirstWelcome({
  user,
  role,
  onGo,
}: {
  user: Me;
  role: WelcomeRole;
  /** Leaves the welcome for this page of the app. */
  onGo: (to: string) => void;
}): JSX.Element {
  const name = firstNameOf(user);
  return (
    <main className="nv-aura fw">
      <section className="nv-plate nv-plate--pad fw__card" aria-labelledby="fw-title">
        <PublicBrand page="Bienvenue" />
        {role === 'creator' ? (
          <CreatorWelcome name={name} onGo={onGo} />
        ) : role === 'chatter' ? (
          <ChatterWelcome name={name} onGo={onGo} />
        ) : (
          <ManagerWelcome name={name} user={user} onGo={onGo} />
        )}
      </section>
    </main>
  );
}

function Hello({ name, lead, children }: { name: string; lead: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="fw__hello nv-enter" style={{ '--nv-i': 0 }}>
      <h1 id="fw-title" className="fw__title">
        {name === '' ? 'Bienvenue' : `Bienvenue, ${name}`}
      </h1>
      <p className="fw__lead">{lead}</p>
      {children}
    </div>
  );
}

const CHECK = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

function Step({
  n,
  next = false,
  title,
  text,
  action,
  done = null,
  onClick,
}: {
  n: number;
  /** The first step still to do: the one the eye reads after the greeting. */
  next?: boolean;
  title: string;
  text: string;
  action: string;
  /** Said in place of the button once the step is done. */
  done?: string | null;
  onClick: () => void;
}): JSX.Element {
  return (
    <li
      className="fw__step nv-tile nv-enter"
      style={{ '--nv-i': n }}
      data-done={done === null ? undefined : 'true'}
      data-next={next && done === null ? 'true' : undefined}
    >
      <span className="fw__num" aria-hidden="true">
        {done === null ? n : CHECK}
      </span>
      <span className="fw__what">
        <b>{title}</b>
        <span>{text}</span>
      </span>
      {done === null ? (
        <button
          type="button"
          className={next ? 'nv-btn nv-btn--neon nv-btn--sm' : 'nv-btn nv-btn--soft nv-btn--sm'}
          onClick={onClick}
        >
          {action}
        </button>
      ) : (
        <span className="fw__state">{done}</span>
      )}
    </li>
  );
}

function CreatorWelcome({ name, onGo }: { name: string; onGo: (to: string) => void }): JSX.Element {
  // A key added just before (the offer after the backup codes) shows as done; a read that fails offers it again.
  const keys = useQuery({ queryKey: ['passkeys', 'own'], queryFn: fetchOwnPasskeys, retry: false });
  const hasKey = (keys.data?.length ?? 0) > 0;
  return (
    <>
      <Hello
        name={name}
        lead="Ton espace est prêt. Trois réglages d’une minute, et l’agence s’occupe du reste."
      />
      <ol className="fw__steps">
        <Step
          n={1}
          next={!hasKey}
          title="Connexion avec Face ID"
          text="Un geste suffit pour entrer, sans mot de passe ni code."
          action="Activer"
          done={hasKey ? 'Activée' : null}
          onClick={() => {
            onGo('/moi/securite');
          }}
        />
        <Step
          n={2}
          next={hasKey}
          title="Active les notifications"
          text="Tu sais tout de suite quand l’agence te demande un contenu, ou qu’un fan achète."
          action="Activer"
          onClick={() => {
            onGo('/notifications');
          }}
        />
        <Step
          n={3}
          title="Mets Impera sur ton écran d’accueil"
          text="Elle s’ouvre comme une app, en plein écran."
          action="Me montrer"
          onClick={() => {
            onGo('/aide/installer');
          }}
        />
      </ol>
      <p className="nv-note fw__info nv-enter" style={{ '--nv-i': 4 }}>
        Chaque jour, <b>« Ma journée »</b> te dit quoi déposer, trois choses au plus. Tu coches quand c’est
        fait.
      </p>
      <div className="fw__foot nv-enter" style={{ '--nv-i': 5 }}>
        <button
          type="button"
          className="nv-btn nv-btn--soft"
          onClick={() => {
            onGo('/aujourdhui');
          }}
        >
          Voir ma journée
        </button>
        <p className="fw__note">Ce qui n’est pas fait t’attendra dans Moi › Réglages.</p>
      </div>
    </>
  );
}

function ChatterWelcome({ name, onGo }: { name: string; onGo: (to: string) => void }): JSX.Element {
  const shifts = useMyShifts().data;
  const first = shifts?.current ?? shifts?.next ?? null;
  return (
    <>
      <Hello
        name={name}
        lead="Avant ton premier shift, trois choses à faire sur ton ordinateur. Compte dix minutes."
      />
      <ol className="fw__steps">
        <Step
          n={1}
          next
          title="Installe l’extension Impera"
          text="Ton outil pendant le shift : dans Chrome, à côté de Reveal."
          action="Installer"
          onClick={() => {
            onGo('/aide/extension');
          }}
        />
        <Step
          n={2}
          title="Relie-la à ton compte"
          text="Un code à coller dans l’extension, une seule fois par navigateur."
          action="Relier"
          onClick={() => {
            onGo('/moi/securite');
          }}
        />
        <Step
          n={3}
          title="Complète ton dossier"
          text="Tes coordonnées et ta facturation : sans elles, pas de paie."
          action="Remplir"
          onClick={() => {
            onGo('/moi/dossier');
          }}
        />
      </ol>
      {first === null ? null : (
        <p className="nv-note fw__info nv-enter" style={{ '--nv-i': 4 }}>
          Ton premier shift :{' '}
          <b>{swapShiftLine(first.startsAt, first.endsAt, first.creatorName, readerZone())}</b>
        </p>
      )}
      <div className="fw__foot nv-enter" style={{ '--nv-i': 5 }}>
        <button
          type="button"
          className="nv-btn nv-btn--soft"
          onClick={() => {
            onGo('/aide/extension');
          }}
        >
          Commencer par l’extension
        </button>
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm fw__later"
          onClick={() => {
            onGo('/');
          }}
        >
          Plus tard
        </button>
        <p className="fw__note">Ces étapes restent dans « À faire » tant qu’elles ne sont pas faites.</p>
      </div>
    </>
  );
}

function ManagerWelcome({
  name,
  user,
  onGo,
}: {
  name: string;
  user: Me;
  onGo: (to: string) => void;
}): JSX.Element {
  const mine = new Set<string>(user.creatorIds);
  const creators = (useCreators().data ?? []).filter((creator) => mine.has(creator.id));
  return (
    <>
      <Hello name={name} lead="Tu veilles sur les créatrices qui te sont confiées et sur leurs chatteurs.">
        {creators.length === 0 ? null : (
          <ul className="fw__chips" aria-label="Tes créatrices">
            {creators.map((creator) => (
              <li key={creator.id} className="nv-chip">
                {creator.displayName}
              </li>
            ))}
          </ul>
        )}
      </Hello>
      <ol className="fw__steps">
        <Step
          n={1}
          next
          title="Dashboard, chaque matin"
          text="Ce qui attend : les fans sans réponse, les rapports à valider."
          action="Ouvrir"
          onClick={() => {
            onGo('/');
          }}
        />
        <Step
          n={2}
          title="Suivi, pendant les shifts"
          text="Les conversations en direct, et la main à reprendre quand l’IA s’arrête."
          action="Ouvrir"
          onClick={() => {
            onGo('/suivi');
          }}
        />
        <Step
          n={3}
          title="Équipe › Planning"
          text="Les shifts de la semaine : tu y remplaces un absent."
          action="Ouvrir"
          onClick={() => {
            onGo('/equipe/planning');
          }}
        />
      </ol>
      <div className="fw__role nv-enter" style={{ '--nv-i': 4 }}>
        <div className="fw__col nv-tile">
          <h2 className="nv-eyebrow">Toi</h2>
          <ul>
            <li>Valider les rapports</li>
            <li>Poser un malus</li>
            <li>Rendre la main à l’IA</li>
          </ul>
        </div>
        <div className="fw__col nv-tile">
          <h2 className="nv-eyebrow">Le propriétaire</h2>
          <ul>
            <li>Primes, prix, paie</li>
            <li>Activer une persona</li>
            <li>Ajouter un membre</li>
          </ul>
        </div>
      </div>
      <div className="fw__foot nv-enter" style={{ '--nv-i': 5 }}>
        <button
          type="button"
          className="nv-btn nv-btn--soft"
          onClick={() => {
            onGo('/');
          }}
        >
          Ouvrir le Dashboard
        </button>
        <p className="fw__note">
          L’extension t’attend dans « À faire » : elle sert aussi à reprendre une conversation.
        </p>
      </div>
    </>
  );
}
