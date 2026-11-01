import { useRef, useState, type JSX } from 'react';

import { RestoreTestDialog } from './RestoreTestDialog';
import { RunNow } from './RunNow';
import { useBackupStatusQuery } from './api';
import { exportViewOf, restoreViewOf, type Tone } from './model';

import './backups.css';

/**
 * Réglages › Sauvegardes (EQ-17, ADR 0028), owner only: the nightly export as a strip, then the restore test, the
 * one thing to do here (« Noter un essai », the page's only neon). Everything is read from `GET /v1/backups/status`.
 * The strip can ask for an export now (REG-24, a soft button): the API records the request, the `backup` service
 * runs it; nothing here starts anything on the PC.
 */
export function BackupsSection(): JSX.Element {
  const status = useBackupStatusQuery();
  const [isOpen, setIsOpen] = useState(false);
  const copyTitle = useRef<HTMLHeadingElement>(null);

  if (status.isPending) {
    return (
      <section className="bk-page" aria-busy="true" aria-label="Sauvegardes">
        <div className="nv-plate bk-skeleton" />
        <div className="nv-plate bk-skeleton bk-skeleton--tall" />
      </section>
    );
  }
  if (status.isError) {
    return (
      <section className="bk-page">
        <div className="nv-plate bk-cover nv-enter" data-tone="warn">
          <p className="bk-cover__title">Le serveur ne répond pas</p>
          <p className="bk-text">L’état des sauvegardes n’a pas pu être lu. Réessaie dans un instant.</p>
          <button
            type="button"
            className="nv-btn nv-btn--soft bk-self-start"
            onClick={() => void status.refetch()}
          >
            Réessayer
          </button>
        </div>
      </section>
    );
  }

  const now = new Date();
  const copy = exportViewOf(status.data, now);
  const restore = restoreViewOf(status.data, now);
  // A test restores a copy that succeeded and checks its fingerprint: without one, any test would be refused.
  const hasCopy = status.data.lastSucceededAt !== null;

  return (
    <section className="bk-page">
      <p className="bk-lede nv-enter">
        Chaque nuit, une copie chiffrée de la base part chez un autre hébergeur. Une copie ne vaut que si on a
        déjà su la restaurer : c’est l’essai, une fois par trimestre.
      </p>

      <article
        className="nv-plate bk-strip nv-enter"
        style={{ '--nv-i': 1 }}
        data-tone={copy.tone}
        aria-labelledby="bk-copy-title"
      >
        <StateDot tone={copy.tone} />
        <div className="bk-strip__body">
          <p className="bk-eyebrow">Sauvegarde de chaque nuit</p>
          <h2 ref={copyTitle} id="bk-copy-title" className="bk-strip__title" tabIndex={-1}>
            {copy.title}
          </h2>
          <p className="bk-text">{copy.text}</p>
          {copy.lastRun === null ? null : <p className="bk-meta">{copy.lastRun}</p>}
          <RunNow status={status.data} landmark={copyTitle} />
        </div>
      </article>

      <article
        className="nv-plate bk-card nv-enter"
        style={{ '--nv-i': 2 }}
        data-tone={restore.tone}
        aria-labelledby="bk-restore-title"
      >
        <div className="bk-card__head">
          <StateDot tone={restore.tone} />
          <p className="bk-eyebrow">Essai de restauration</p>
        </div>
        <h2 id="bk-restore-title" className="bk-card__title">
          {restore.title}
        </h2>
        <p className="bk-text">{restore.text}</p>
        {restore.validity === null ? null : <p className="bk-validity">{restore.validity}</p>}
        <button
          type="button"
          className={`nv-btn ${hasCopy ? 'nv-btn--neon' : 'nv-btn--soft'} bk-self-start`}
          disabled={!hasCopy}
          aria-describedby={hasCopy ? undefined : 'bk-restore-needs-copy'}
          onClick={() => {
            setIsOpen(true);
          }}
        >
          Noter un essai
        </button>
        {hasCopy ? null : (
          <p id="bk-restore-needs-copy" className="bk-meta">
            Il faut d’abord une sauvegarde réussie à restaurer.
          </p>
        )}
        {/* REG-23: open by itself while the test is not fresh, the steps are then the thing to read. */}
        <details className="nv-disclosure bk-how" open={!status.data.restoreTestFresh}>
          <summary>
            <span className="nv-disclosure__title">Comment se joue un essai</span>
            <span className="nv-disclosure__sum">Sur ton PC, rien ne part</span>
          </summary>
          <ol className="nv-disclosure__body bk-steps">
            <li>Une session Claude sur ton PC le joue : tu approuves, tu ne tapes aucune commande.</li>
            <li>
              Elle restaure la dernière sauvegarde dans une base jetable, sans les clés de l’application :
              rien ne peut joindre un fan ni un service.
            </li>
            <li>
              Elle te donne son compte rendu : l’empreinte de la sauvegarde, la durée et les tables qui
              diffèrent.
            </li>
            <li>
              Tu le colles dans « Noter un essai ». Nirvana le rapproche d’une sauvegarde réussie, et refuse
              une empreinte qu’il ne connaît pas.
            </li>
          </ol>
        </details>
      </article>

      {isOpen ? (
        <RestoreTestDialog
          onClose={() => {
            setIsOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function StateDot({ tone }: { tone: Tone }): JSX.Element {
  return <span className="bk-dot" data-tone={tone} aria-hidden="true" />;
}
