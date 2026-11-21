import type { ToTalk, ToTalkFan } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useToTalk } from './api';
import { standingOf, TIER_WORDS, whenOf } from './view';
import './to-talk.css';

/**
 * « À qui parler maintenant » (accueil du chatteur, Charles 21/11): the method's order on his shift's creator. Payers
 * who wait, then the new ones, then the big payers gone quiet; each with his tier, what he spent and when he last
 * bought, as Reveal shows it. A doubt on age is said in red and never listed: a human lifts it first.
 */
export function ToTalkCard({ creatorId, now }: { creatorId: string; now: Date }): JSX.Element | null {
  const read = useToTalk(creatorId);
  const data = read.data;
  // Silent while it loads or fails: the hero's « Ouvrir Suivi » stays the way in.
  if (data === undefined) return null;
  const empty = data.waiting.length + data.newcomers.length + data.silent.length === 0;
  return (
    <section className="nv-plate tt-card nv-enter" aria-labelledby="tt-title">
      <header className="tt-head">
        <h2 id="tt-title" className="nv-h2">
          À qui parler maintenant
        </h2>
        {empty ? null : <span className="tt-hint">dans cet ordre</span>}
      </header>
      {empty ? <p className="tt-empty">Personne n’attend : tout le monde a sa réponse.</p> : null}
      <Group title="Payeurs qui attendent" fans={data.waiting} creatorId={creatorId} now={now} />
      <Group title="Nouveaux à accueillir" fans={data.newcomers} creatorId={creatorId} now={now} />
      <Group
        title="Gros fans silencieux"
        fans={data.silent}
        creatorId={creatorId}
        now={now}
        action="Relancer"
      />
      <AgeHeld data={data} creatorId={creatorId} />
    </section>
  );
}

function Group({
  title,
  fans,
  creatorId,
  now,
  action = 'Ouvrir',
}: {
  title: string;
  fans: readonly ToTalkFan[];
  creatorId: string;
  now: Date;
  action?: string;
}): JSX.Element | null {
  if (fans.length === 0) return null;
  return (
    <div className="tt-group">
      <h3 className="tt-group__title">{title}</h3>
      <ul className="tt-list">
        {fans.map((fan) => {
          const when = whenOf(fan, now);
          return (
            <li key={fan.conversationId}>
              <Link
                to="/suivi"
                search={{ conversation: fan.conversationId, creatrice: creatorId }}
                className="tt-row nv-tap"
                aria-label={`${fan.fanDisplayName} : ${action.toLowerCase()} sa conversation dans Suivi`}
              >
                {fan.tier === null ? (
                  <span className="tt-tier" />
                ) : (
                  <span className="tt-tier" data-tier={fan.tier}>
                    {TIER_WORDS[fan.tier]}
                  </span>
                )}
                <span className="tt-who">
                  <b className="tt-name">{fan.fanDisplayName}</b>
                  <span className="tt-standing nv-num">{standingOf(fan, now)}</span>
                </span>
                <span className="tt-when nv-num" data-long={when.long || undefined}>
                  {when.text}
                </span>
                <span className="nv-btn nv-btn--soft nv-btn--sm tt-go" aria-hidden="true">
                  {action}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AgeHeld({ data, creatorId }: { data: ToTalk; creatorId: string }): JSX.Element | null {
  if (data.ageHeld === 0) return null;
  return (
    <Link to="/suivi" search={{ creatrice: creatorId }} className="tt-held nv-tap">
      <span className="tt-held__dot" aria-hidden="true" />
      <span className="tt-held__text">
        {data.ageHeld === 1
          ? '1 conversation bloquée : doute sur l’âge, un manager doit lever'
          : `${String(data.ageHeld)} conversations bloquées : doute sur l’âge, un manager doit lever`}
      </span>
      <span className="tt-held__see">Voir</span>
    </Link>
  );
}
