import {
  isSetupComplete,
  type CreatorOverview,
  type CreatorSetup,
  type CreatorSummary,
  type CreatorTodoCount,
} from '@impera/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { CreatorFace } from '../CreatorFace';
import { creatorsSearch, type CreatorSheet } from '../search';

import { useCreatorsOverview } from './api';
import { modeOf, onShiftOf, requestOf, salesOf, todosOf, type Tone } from './model';
import './list.css';

import { readerZone, dayOf } from '@/scheduling/time';
import { todosAcrossQuery } from '@/screens/tracking/api';
import { SetupLink } from '@/setup/SetupCard';
import { useCreatorSetups } from '@/setup/api';
import { creatorLines, nextOf, progressOf } from '@/setup/model';

/**
 * The list of Créatrices (« ok liste-créatrices », Charles, 06/11): one card per creator, what the agency needs to know
 * of her before opening her sheet. Her agent's mode, the revenue of her fortnight, who is on shift on her now, the
 * content she still owes, what waits in « À traiter », and for the owner how far her « Mise en route » is. A click opens her
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
  const setups = useCreatorSetups(isOwner);
  const steps = new Map((setups.data ?? []).map((setup) => [setup.creatorId, setup] as const));
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
            setup={isOwner ? steps.get(creator.id) : undefined}
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
  setup,
}: {
  creator: CreatorSummary;
  card: CreatorOverview | undefined;
  loading: boolean;
  count: CreatorTodoCount | undefined;
  sheet: CreatorSheet;
  /** Her « Mise en route », the owner's alone. */
  setup: CreatorSetup | undefined;
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
          {/* The whole card opens her sheet; the link of « Mise en route » stays its own. */}
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
      <Setup setup={setup} />
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

/**
 * « Mise en route » (pilotage plan W1), the owner's: how far she is and her next step, which opens where it is done;
 * the whole list is on her sheet. Nothing while the read is under way or fails, rather than a wrong line; nothing once
 * all is done.
 */
function Setup({ setup }: { setup: CreatorSetup | undefined }): JSX.Element | null {
  if (setup === undefined || isSetupComplete(setup.steps)) return null;
  const lines = creatorLines(setup.creatorId, setup.steps);
  const { done, total } = progressOf(lines);
  const next = nextOf(lines);
  return (
    <p className="cl-card__setup">
      <span className="cl-card__setup-label">Mise en route</span>
      <span className="nv-num">
        {done} sur {total}
      </span>
      {next === undefined || next.target === null ? null : (
        <SetupLink target={next.target} className="cl-card__step" label={`Prochaine étape : ${next.label}`}>
          {next.label}
        </SetupLink>
      )}
    </p>
  );
}
