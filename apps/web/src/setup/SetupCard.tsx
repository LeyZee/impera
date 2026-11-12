import { Link } from '@tanstack/react-router';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { nextOf, progressOf, type SetupLine, type SetupTarget } from './model';
import './setup.css';

import { creatorsSearch } from '@/creators/search';
import { dashboardSearch } from '@/screens/dashboard/logic';

/**
 * « Mise en route » (pilotage plan W1): one card, the count and the next step at a glance; « Tout voir » unfolds every
 * step left, then those done. The server ticks each step; the caller shows nothing once all are done.
 */
export function SetupCard({ lines, label }: { lines: readonly SetupLine[]; label: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const listId = useId();
  const { done, total } = progressOf(lines);
  const left = lines.filter((line) => line.state !== 'done');
  const finished = lines.filter((line) => line.state === 'done');
  const next = nextOf(lines);
  return (
    <section className="nv-plate su-card nv-enter" aria-label={label}>
      <header className="su-head">
        <p className="su-title">Mise en route</p>
        <p className="su-count nv-num">
          {done} sur {total}
        </p>
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm su-toggle"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            setOpen((shown) => !shown);
          }}
        >
          {open ? 'Replier' : 'Tout voir'}
        </button>
      </header>
      <div
        className="su-meter"
        role="progressbar"
        aria-label="Étapes faites"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <span
          className="su-meter__fill"
          style={{ inlineSize: `${String(total === 0 ? 0 : (done / total) * 100)}%` }}
        />
      </div>
      <ul className="su-list" id={listId}>
        {open ? (
          <>
            {left.map((line) => (
              <Step key={line.key} line={line} />
            ))}
            {showDone ? finished.map((line) => <Step key={line.key} line={line} />) : null}
          </>
        ) : next === undefined ? null : (
          <Step line={next} lead />
        )}
      </ul>
      {open && finished.length > 0 ? (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm su-more"
          aria-expanded={showDone}
          onClick={() => {
            setShowDone((shown) => !shown);
          }}
        >
          {showDone
            ? 'Masquer les étapes faites'
            : `Voir ${finished.length === 1 ? 'l’étape faite' : `les ${String(finished.length)} étapes faites`}`}
        </button>
      ) : null}
    </section>
  );
}

const STATE_WORDS = { done: 'Fait', todo: 'À faire', waiting: 'En attente' } as const;

function Step({ line, lead = false }: { line: SetupLine; lead?: boolean }): JSX.Element {
  return (
    <li className={`su-step su-step--${line.state}`}>
      <Mark state={line.state} />
      <div className="su-step__text">
        {lead ? <span className="nv-meta">Prochaine étape</span> : null}
        <span className="su-step__label">
          {line.label}
          <span className="su-sr"> · {STATE_WORDS[line.state]}</span>
        </span>
        {line.hint === null ? null : <span className="su-step__hint">{line.hint}</span>}
      </div>
      {line.target === null ? null : <Go target={line.target} line={line} />}
    </li>
  );
}

/** A tick, a ring to fill, or a clock: the word is read out beside it, never the colour alone. */
function Mark({ state }: { state: SetupLine['state'] }): JSX.Element {
  return (
    <svg className="su-mark" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.25" />
      {state === 'done' ? <path d="m6.5 10.2 2.4 2.4 4.6-5" /> : null}
      {state === 'waiting' ? <path d="M10 6.2V10l2.6 1.6" /> : null}
    </svg>
  );
}

function Go({ target, line }: { target: SetupTarget; line: SetupLine }): JSX.Element {
  // What waits on someone else asks nothing of the agency: it is only looked at.
  const text = line.state === 'todo' ? line.verb : 'Voir';
  return (
    <SetupLink
      target={target}
      className={`nv-btn ${line.state === 'todo' ? 'nv-btn--soft' : 'nv-btn--plain'} nv-btn--sm su-go`}
      label={`${text} : ${line.label}`}
    >
      {text}
    </SetupLink>
  );
}

/** The link to where a step is done: her sheet, her Dashboard, or a page of the CRM. */
export function SetupLink({
  target,
  className,
  label,
  children,
}: {
  target: SetupTarget;
  className: string;
  label?: string;
  children: ReactNode;
}): JSX.Element {
  switch (target.kind) {
    case 'sheet':
      return (
        <Link
          to="/creatrices"
          search={creatorsSearch(target.sheet, target.creatorId)}
          className={className}
          aria-label={label}
        >
          {children}
        </Link>
      );
    case 'dashboard':
      return (
        <Link
          to="/"
          search={dashboardSearch('day', target.creatorId)}
          className={className}
          aria-label={label}
        >
          {children}
        </Link>
      );
    case 'file':
      return (
        <Link
          to="/equipe/membres/$memberId/dossier"
          params={{ memberId: target.memberId }}
          className={className}
          aria-label={label}
        >
          {children}
        </Link>
      );
    case 'page':
      return (
        <Link to={target.to} className={className} aria-label={label}>
          {children}
        </Link>
      );
  }
}
