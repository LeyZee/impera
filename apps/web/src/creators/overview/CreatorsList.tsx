import type { CreatorId, CreatorOverview, CreatorSummary, CreatorTodoCount } from '@impera/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { CreatorFace } from '../CreatorFace';
import { useCreatorAccount, usePersonaVersionCount } from '../api';
import { useAgencyRates } from '../rate/api';
import { creatorsSearch, type CreatorSheet } from '../search';
import { isSetUp, setupSteps } from '../setup';

import { useCreatorsOverview } from './api';
import { modeOf, onShiftOf, requestOf, salesOf, todosOf, type Tone } from './model';
import './list.css';

import { readerZone, dayOf } from '@/scheduling/time';
import { todosAcrossQuery } from '@/screens/tracking/api';

/**
 * The list of Créatrices (« ok liste-créatrices », Charles, 06/11): one card per creator, what the agency needs to know
 * of her before opening her sheet. Her agent's mode, the revenue of her fortnight, who is on shift on her now, the
 * content she still owes, what waits in « À traiter », and for the owner what is left to set up. A click opens her
 * sheet on `sheet`. What the reader may not see the server leaves out, and the card says nothing of it.
 */
export function CreatorsList({
  creators,
  sheet,
  isOwner,
}: {
  creators: readonly CreatorSummary[];
  sheet: CreatorSheet;
  isOwner: boolean;
}): JSX.Element {
  const overview = useCreatorsOverview();
  const queue = useQuery(todosAcrossQuery);
  const cards = new Map((overview.data ?? []).map((card) => [card.creatorId, card] as const));
  const counts = new Map((queue.data?.creators ?? []).map((count) => [count.creatorId, count] as const));
  return (
    <section className="cl-page" aria-label="Créatrices">
      {overview.isError ? (
        <p className="ps-muted cl-note" role="status">
          Les chiffres des créatrices ne se chargent pas : leurs fiches s’ouvrent quand même.
        </p>
      ) : null}
      <ul className="cl-grid">
        {creators.map((creator) => (
          <CreatorCard
            key={creator.id}
            creator={creator}
            card={cards.get(creator.id)}
            loading={overview.isPending}
            count={counts.get(creator.id)}
            sheet={sheet}
            isOwner={isOwner}
          />
        ))}
      </ul>
    </section>
  );
}

function CreatorCard({
  creator,
  card,
  loading,
  count,
  sheet,
  isOwner,
}: {
  creator: CreatorSummary;
  card: CreatorOverview | undefined;
  loading: boolean;
  count: CreatorTodoCount | undefined;
  sheet: CreatorSheet;
  isOwner: boolean;
}): JSX.Element {
  const mode = card === undefined ? null : modeOf(card.mode);
  const todos = todosOf(count);
  const today = dayOf(new Date(), creator.timezone);
  const request = card?.requests == null ? null : requestOf(card.requests, today);
  return (
    <li className="cl-card nv-plate nv-enter" aria-busy={loading || undefined}>
      <div className="cl-card__head">
        <CreatorFace creator={creator} className="cl-card__face" />
        <div className="cl-card__title">
          {/* The whole card opens her sheet; the links of « À configurer » stay their own. */}
          <Link to="/creatrices" search={creatorsSearch(sheet, creator.id)} className="cl-card__name">
            {creator.displayName}
          </Link>
          {mode === null ? (
            <span className="cl-card__mode cl-card__mode--empty" aria-hidden="true" />
          ) : (
            <span className="cl-card__mode">
              <span className={`nv-dot nv-tone--${mode.tone}`} aria-hidden="true" />
              {mode.label}
            </span>
          )}
        </div>
        <svg className="cl-card__go" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
      </div>
      <dl className="cl-card__facts">
        {card === undefined || card.onShift === null ? null : (
          <Fact label="Chiffre d’affaires" {...salesOf(card.sales)} strong />
        )}
        {card?.onShift == null ? null : (
          <Fact label="En poste" value={onShiftOf(card.onShift, readerZone())} />
        )}
        {card?.requests == null ? null : request === null ? (
          <Fact label="Contenu attendu" value="Rien en attente" tone="calm" />
        ) : (
          <Fact
            label="Contenu attendu"
            value={request.value}
            note={request.note}
            {...(request.late ? { noteTone: 'warn' as const } : {})}
          />
        )}
        <Fact label="À traiter" value={todos.text} tone={todos.tone} />
      </dl>
      {isOwner ? <Setup creatorId={creator.id} /> : null}
    </li>
  );
}

function Fact({
  label,
  value,
  note,
  tone,
  noteTone,
  strong = false,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
  noteTone?: Tone;
  strong?: boolean;
}): JSX.Element {
  return (
    <div className="cl-fact">
      <dt className="cl-fact__label">{label}</dt>
      <dd className="cl-fact__value">
        <span
          className={[
            strong ? 'cl-fact__strong nv-num' : '',
            tone === undefined || tone === 'calm' ? '' : `cl-tone--${tone}`,
            tone === 'calm' ? 'cl-fact__quiet' : '',
          ]
            .filter((name) => name !== '')
            .join(' ')}
        >
          {value}
        </span>
        {note === undefined ? null : (
          <span className={noteTone === undefined ? 'cl-fact__note' : `cl-fact__note cl-tone--${noteTone}`}>
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}

const SHORT: Readonly<Record<CreatorSheet, string>> = {
  persona: 'Persona',
  rate: 'Pourcentage',
  access: 'Accès',
  agenda: 'Agenda',
  ideas: 'Idées du jour',
  requests: 'Demandes',
  scripts: 'Scripts',
  telegram: 'Canal Telegram',
  hours: 'Heures d’activité',
  profile: 'Profil',
};

/**
 * What is left to set up (CRM-07 b2), the owner's: each step opens its tab. Nothing while a read is under way or
 * fails, rather than a wrong line; nothing once all is done.
 */
function Setup({ creatorId }: { creatorId: CreatorId }): JSX.Element | null {
  const persona = usePersonaVersionCount(creatorId);
  const rates = useAgencyRates(creatorId);
  const account = useCreatorAccount(creatorId);
  if (persona.data === undefined || rates.data === undefined || account.data === undefined) return null;
  const steps = setupSteps({
    personaVersions: persona.data,
    hasRate: rates.data.current !== null,
    account: account.data,
  });
  if (isSetUp(steps)) return null;
  const left = steps.filter((step) => step.state !== 'done');
  return (
    <p className="cl-card__setup">
      <span className="cl-card__setup-label">À configurer</span>
      {left.map((step) => (
        <Link
          key={step.sheet}
          to="/creatrices"
          search={creatorsSearch(step.sheet, creatorId)}
          className="cl-card__step"
          title={step.hint}
        >
          {SHORT[step.sheet]}
          {step.state === 'waiting' ? ' · invitation envoyée' : null}
        </Link>
      ))}
    </p>
  );
}
