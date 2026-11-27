import type { ChannelPlannedPost, ChannelPostGesture, CreatorId } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { ChannelRefused, CHANNEL_ERRORS, channelErrorKind } from '../api';

import { channelGesture, thumbnailUrl, useChannelWeek, validateChannelWeek, weekQueryKey } from './api';
import {
  addDays,
  draftWords,
  hourOf,
  isOpen,
  KIND_COLOUR,
  KIND_LABEL,
  partOfDay,
  stateLine,
  THEME_LABEL,
  weekToOpen,
  weekView,
  windowWords,
  waitsForRead,
  type WeekDay,
} from './model';
import './channel-week.css';

import { Donut, Ring, useLit } from '@/shell/figures/figures';

/**
 * « La semaine du canal » (ADR 0162 § 3, maquette validée le 21/11): the answer first (how many posts wait for a read,
 * and « Tout valider » beside it), the week by kind in a donut, then her seven days and their posts by hour. A post
 * opens in place with its gestures. What nobody reads goes out at its hour all the same: reading is a bonus.
 */
export function ChannelWeekSection({
  creatorId,
  timeZone,
  now = () => new Date(),
}: {
  creatorId: CreatorId;
  timeZone: string;
  now?: () => Date;
}): JSX.Element | null {
  const [week, setWeek] = useState(() => weekToOpen(now(), timeZone));
  const query = useChannelWeek(creatorId, week);
  const queryClient = useQueryClient();
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const { lit, setLit, row } = useLit();

  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: weekQueryKey(creatorId, week) });
  const failure = (error: unknown): string =>
    error instanceof ChannelRefused ? error.message : CHANNEL_ERRORS[channelErrorKind(error)];

  if (query.isPending) {
    return <section className="nv-plate cw-page" aria-busy="true" aria-label="La semaine du canal" />;
  }
  if (query.isError) {
    return (
      <section className="nv-plate cw-page" aria-label="La semaine du canal">
        <p className="nv-note nv-note--warn">{failure(query.error)}</p>
      </section>
    );
  }

  const at = now();
  const view = weekView(query.data, at, timeZone);
  const todayIndex = view.days.findIndex((day) => day.today);
  const shownIndex = dayIndex ?? Math.max(0, todayIndex);
  const shown = view.days[shownIndex];
  const litKind = lit === null ? undefined : view.byKind[lit];

  const validateAll = async (): Promise<void> => {
    setConfirming(false);
    setBusy(true);
    setSaid(null);
    try {
      const count = await validateChannelWeek(creatorId, week);
      setSaid({ text: count === 1 ? '1 post validé.' : `${String(count)} posts validés.`, tone: 'ok' });
      await refresh();
    } catch (error) {
      setSaid({ text: failure(error), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  const goWeek = (days: number): void => {
    setWeek(addDays(week, days));
    setDayIndex(null);
    setOpened(null);
    setSaid(null);
    setConfirming(false);
  };

  return (
    <section className="nv-plate cw-page nv-enter" aria-labelledby="cw-title">
      <header className="cw-head">
        <div className="cw-head__titles">
          <span className="nv-eyebrow">Son canal Telegram</span>
          <h2 className="nv-h2" id="cw-title">
            {view.title}
          </h2>
          <p className="cw-head__dates">{view.dates}</p>
        </div>
        <div className="cw-head__weeks" role="group" aria-label="Changer de semaine">
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm cw-head__arrow"
            aria-label="Semaine d’avant"
            onClick={() => {
              goWeek(-7);
            }}
          >
            <Chevron back />
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm cw-head__arrow"
            aria-label="Semaine d’après"
            onClick={() => {
              goWeek(7);
            }}
          >
            <Chevron />
          </button>
        </div>
      </header>

      <div className="cw-answer">
        <Ring
          share={view.total === 0 ? 0 : view.reviewed / view.total}
          label={`Relus : ${String(view.reviewed)} sur ${String(view.total)}`}
          colour="var(--nv-series-1)"
          full={view.total > 0 && view.waiting === 0}
          className="cw-answer__ring"
        >
          <b className="nv-num">{view.reviewed}</b>
          <span>sur {view.total}</span>
        </Ring>
        <div className="cw-answer__words">
          <p className="cw-answer__big" aria-live="polite">
            {view.answer}
          </p>
          <p className="cw-answer__line">{view.line}</p>
          {said === null ? null : (
            <p className={said.tone === 'ok' ? 'cw-said' : 'cw-said cw-said--warn'} role="status">
              {said.text}
            </p>
          )}
        </div>
        {view.waiting === 0 ? null : confirming ? (
          <div className="cw-answer__go cw-confirm" role="group" aria-label="Confirmer">
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => void validateAll()}
            >
              {`Oui, valider les ${String(view.waiting)}`}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="nv-btn nv-btn--soft cw-answer__go"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {busy ? 'Validation…' : 'Tout valider'}
          </button>
        )}
      </div>

      {view.total === 0 ? null : (
        <div className="nv-donut-row cw-kinds">
          <Donut
            label={`La semaine par type : ${view.byKind.map((one) => `${KIND_LABEL[one.kind]} ${String(one.count)}`).join(', ')}`}
            slices={view.byKind.map((one) => ({
              key: one.kind,
              colour: KIND_COLOUR[one.kind],
              value: one.count,
            }))}
            lit={lit}
            onLit={setLit}
          >
            {litKind === undefined ? (
              <>
                <b className="nv-donut__value">{view.total}</b>
                <span className="nv-donut__sub">posts</span>
              </>
            ) : (
              <>
                <b className="nv-donut__value">{litKind.count}</b>
                <span className="nv-donut__sub">{KIND_LABEL[litKind.kind]}</span>
              </>
            )}
          </Donut>
          <ul className="nv-breakdown cw-legend">
            {view.byKind.map((one, index) => (
              <li key={one.kind}>
                <button
                  type="button"
                  className={lit === index ? 'nv-breakdown__row is-on' : 'nv-breakdown__row'}
                  {...row(index)}
                >
                  <span className="nv-key" style={{ '--_c': KIND_COLOUR[one.kind] }} aria-hidden="true" />
                  <span className="nv-breakdown__label">{KIND_LABEL[one.kind]}</span>
                  <span className="nv-breakdown__value nv-num">{one.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <nav className="cw-days" aria-label="Jours de la semaine">
        {view.days.map((day, index) => (
          <button
            key={day.day}
            type="button"
            className="cw-day"
            aria-pressed={index === shownIndex}
            data-today={day.today || undefined}
            aria-label={`${day.weekday} ${String(day.number)}${day.waiting > 0 ? `, ${String(day.waiting)} à relire` : ''}`}
            onClick={() => {
              setDayIndex(index);
              setOpened(null);
            }}
          >
            <span className="cw-day__name">{day.short}</span>
            <span className="cw-day__number nv-num">{day.number}</span>
            {day.waiting === 0 && day.posts.length > 0 ? (
              <span className="cw-day__done" aria-hidden="true">
                <Check />
              </span>
            ) : (
              <span className="cw-day__dots" aria-hidden="true">
                {day.posts
                  .filter((post) => post.state !== 'removed' && waitsForRead(post, at))
                  .map((post) => (
                    <i key={post.id} style={{ '--_c': KIND_COLOUR[post.kind] }} />
                  ))}
              </span>
            )}
          </button>
        ))}
      </nav>
      <p className="cw-key">
        <span>
          <i className="cw-key__dot" aria-hidden="true" />
          Un post à relire, dans la couleur de son type
        </span>
        <span>
          <span className="cw-key__check" aria-hidden="true">
            <Check />
          </span>
          Jour relu
        </span>
      </p>

      {shown === undefined ? null : (
        <Day
          day={shown}
          creatorId={creatorId}
          timeZone={timeZone}
          now={at}
          opened={opened}
          onOpen={setOpened}
          onChanged={refresh}
          failure={failure}
          thumbnailOf={(mediaId) => {
            const place = mediaId === null ? undefined : query.data.thumbnails[mediaId];
            return place === undefined ? null : thumbnailUrl(creatorId, place);
          }}
        />
      )}
    </section>
  );
}

function Day({
  day,
  creatorId,
  timeZone,
  now,
  opened,
  onOpen,
  onChanged,
  failure,
  thumbnailOf,
}: {
  day: WeekDay;
  creatorId: CreatorId;
  timeZone: string;
  now: Date;
  opened: string | null;
  onOpen: (id: string | null) => void;
  onChanged: () => Promise<void>;
  failure: (error: unknown) => string;
  thumbnailOf: (mediaId: string | null) => string | null;
}): JSX.Element {
  return (
    <section className="cw-list" aria-label={`${day.weekday} ${String(day.number)}`}>
      {day.posts.length === 0 ? (
        <p className="cw-empty">Rien de prévu ce jour-là.</p>
      ) : (
        day.posts.map((post, index) => (
          <Post
            key={post.id}
            post={post}
            index={index}
            creatorId={creatorId}
            timeZone={timeZone}
            now={now}
            thumbnail={thumbnailOf(post.mediaId)}
            open={opened === post.id}
            onToggle={() => {
              onOpen(opened === post.id ? null : post.id);
            }}
            onChanged={onChanged}
            failure={failure}
          />
        ))
      )}
    </section>
  );
}

function Post({
  post,
  index,
  creatorId,
  timeZone,
  now,
  thumbnail,
  open,
  onToggle,
  onChanged,
  failure,
}: {
  post: ChannelPlannedPost;
  index: number;
  creatorId: CreatorId;
  timeZone: string;
  now: Date;
  thumbnail: string | null;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  failure: (error: unknown) => string;
}): JSX.Element {
  const id = useId();
  const words = draftWords(post);
  const line = stateLine(post, timeZone);
  const removed = post.state === 'removed';
  const colour = KIND_COLOUR[post.kind];
  const label = post.repost ? `${KIND_LABEL[post.kind]} · repris` : KIND_LABEL[post.kind];
  return (
    <article
      className="cw-post"
      data-state={post.state}
      data-open={open || undefined}
      data-read={(!removed && line.tone !== 'todo') || undefined}
      style={{ '--_c': colour, '--nv-i': index }}
    >
      <button
        type="button"
        className="cw-post__head"
        aria-expanded={open}
        aria-controls={id}
        disabled={removed}
        onClick={onToggle}
      >
        <span className="cw-post__when">
          <b className="nv-num">{hourOf(post.at, timeZone)}</b>
          <span>{partOfDay(post.window.from)}</span>
        </span>
        <span className="cw-post__body">
          <span className="cw-post__tags">
            <span className="nv-tag nv-tag--tint" style={{ '--_c': colour }}>
              {label}
            </span>
            {post.theme === 'poll' || post.theme === 'evening' ? null : (
              <span className="cw-post__theme">{THEME_LABEL[post.theme]}</span>
            )}
          </span>
          {removed ? null : (
            <span className="cw-post__content">
              {thumbnail === null ? null : (
                <img className="cw-post__thumb" src={thumbnail} alt="Son visuel" loading="lazy" />
              )}
              <span className="cw-post__text">{words === null ? 'Le texte s’écrit…' : words.text}</span>
            </span>
          )}
          {line.tone === 'todo' ? (
            <span className="nv-tag cw-post__todo">{line.text}</span>
          ) : (
            <span className="cw-post__state" data-tone={line.tone}>
              {line.tone === 'done' ? <Check /> : null}
              {line.text}
            </span>
          )}
        </span>
        {removed ? null : <span className="cw-post__chev" aria-hidden="true" />}
      </button>
      {open && !removed ? (
        <PostOpen
          id={id}
          post={post}
          creatorId={creatorId}
          timeZone={timeZone}
          gestures={isOpen(post, now)}
          onChanged={onChanged}
          failure={failure}
        />
      ) : null}
    </article>
  );
}

function PostOpen({
  id,
  post,
  creatorId,
  timeZone,
  gestures,
  onChanged,
  failure,
}: {
  id: string;
  post: ChannelPlannedPost;
  creatorId: CreatorId;
  timeZone: string;
  gestures: boolean;
  onChanged: () => Promise<void>;
  failure: (error: unknown) => string;
}): JSX.Element {
  const words = draftWords(post);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(words?.text ?? '');
  const [advice, setAdvice] = useState('');
  const [busy, setBusy] = useState<ChannelPostGesture['gesture'] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const act = async (gesture: ChannelPostGesture): Promise<void> => {
    setBusy(gesture.gesture);
    setProblem(null);
    try {
      await channelGesture(creatorId, post.id, gesture);
      setEditing(false);
      setAdvice('');
      await onChanged();
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cw-open" id={id}>
      {words !== null && words.options.length > 0 ? (
        <ul className="cw-open__options" aria-label="Réponses du sondage">
          {words.options.map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ul>
      ) : null}
      {post.why === null ? null : <p className="cw-open__why">{post.why}</p>}
      <p className="cw-open__when">
        Part à {hourOf(post.at, timeZone)}, tiré dans sa fenêtre ({windowWords(post.window)}).
        {post.locked ? '' : ' Sans relecture, il part quand même.'}
      </p>
      {problem === null ? null : (
        <p className="nv-note nv-note--warn" role="alert">
          {problem}
        </p>
      )}
      {!gestures ? null : editing ? (
        <div className="cw-open__edit">
          <label className="nv-field">
            <span className="nv-field__label">Son texte</span>
            <textarea
              className="nv-field__control cw-open__area"
              rows={4}
              maxLength={1000}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </label>
          <div className="cw-open__row">
            <button
              type="button"
              className="nv-btn nv-btn--neon"
              disabled={busy !== null || text.trim().length === 0}
              aria-busy={busy === 'edit'}
              onClick={() => void act({ gesture: 'edit', text })}
            >
              {busy === 'edit' ? 'Enregistrement…' : 'Enregistrer ce texte'}
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--plain"
              onClick={() => {
                setEditing(false);
                setText(words?.text ?? '');
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="cw-open__gestures">
            {post.locked ? null : (
              <button
                type="button"
                className="nv-btn nv-btn--neon cw-open__main"
                disabled={busy !== null}
                aria-busy={busy === 'validate'}
                onClick={() => void act({ gesture: 'validate' })}
              >
                {busy === 'validate' ? 'Validation…' : 'Valider'}
              </button>
            )}
            {post.draft?.kind === 'post' ? (
              <button
                type="button"
                className="nv-btn nv-btn--soft"
                disabled={busy !== null}
                onClick={() => {
                  setEditing(true);
                }}
              >
                Modifier le texte
              </button>
            ) : null}
            {post.mediaId === null ? null : (
              <button
                type="button"
                className="nv-btn nv-btn--soft"
                disabled={busy !== null}
                aria-busy={busy === 'change_visual'}
                onClick={() => void act({ gesture: 'change_visual' })}
              >
                {busy === 'change_visual' ? 'Changement…' : 'Changer de visuel'}
              </button>
            )}
          </div>
          <div className="cw-open__advice">
            <div className="cw-open__row">
              <label className="nv-field">
                <span className="nv-field__label">Réécrire avec un conseil</span>
                <input
                  className="nv-field__control"
                  maxLength={200}
                  placeholder="Plus taquin, parle du week-end…"
                  value={advice}
                  onChange={(event) => {
                    setAdvice(event.target.value);
                  }}
                />
              </label>
              <button
                type="button"
                className="nv-btn nv-btn--soft"
                disabled={busy !== null}
                aria-busy={busy === 'rewrite'}
                onClick={() =>
                  void act({ gesture: 'rewrite', advice: advice.trim() === '' ? null : advice.trim() })
                }
              >
                {busy === 'rewrite' ? 'Réécriture…' : 'Réécrire'}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm cw-open__remove"
            disabled={busy !== null}
            aria-busy={busy === 'remove'}
            onClick={() => void act({ gesture: 'remove' })}
          >
            Retirer ce post (un autre le remplace)
          </button>
        </>
      )}
    </div>
  );
}

function Chevron({ back = false }: { back?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d={back ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Check(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
