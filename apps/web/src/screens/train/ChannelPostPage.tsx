import {
  CHANNEL_ADVICE_MAX,
  CHANNEL_MEDIA_TEXT_MAX,
  type ChannelPostKind,
  type RedirectLinkId,
  type TriedChannelPost,
} from '@impera/contracts';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { violationLabel } from './channel/model';

import { useCreators } from '@/creators/api';
import { Segment } from '@/creators/persona/fields';
import {
  CHANNEL_ERRORS,
  ChannelRefused,
  channelErrorKind,
  tryChannelPost,
  useTelegramChannel,
} from '@/creators/telegram/api';
import { Select, type SelectOption } from '@/shell/Select';

import '@/creators/persona/persona.css';
import '@/creators/telegram/telegram-channel.css';
import './channel/channel-post.css';

/**
 * Entraîner › Post du canal (ADR 0080 § 7): her channel's post or poll written as production will write it, with her
 * persona, her examples and where the link leads, then the guards. Nothing is published.
 */

const KINDS = [
  { value: 'post', label: 'Post' },
  { value: 'poll', label: 'Sondage' },
] as const;

/** « Le lien du canal » is her channel's link, whichever it is; another one is tried by its name. */
const CHANNEL_LINK = 'channel';
type LinkChoice = RedirectLinkId | typeof CHANNEL_LINK;

export function ChannelPostPage(): JSX.Element {
  const creators = useCreators();
  const [creatorId, setCreatorId] = useState('');
  const list = creators.data ?? [];
  useEffect(() => {
    const first = list[0];
    if (creatorId === '' && first !== undefined) setCreatorId(first.id);
  }, [creatorId, list]);

  if (creators.isPending) return <p className="cp-state">Chargement…</p>;
  if (creators.isError) return <p className="cp-state">{CHANNEL_ERRORS.unavailable}</p>;
  if (list.length === 0) {
    return <p className="cp-state">Aucune créatrice : ajoute-la dans Créatrices pour écrire son post.</p>;
  }
  const options: SelectOption<string>[] = list.map((one) => ({ value: one.id, label: one.displayName }));
  const name = list.find((one) => one.id === creatorId)?.displayName ?? '';
  return creatorId === '' ? (
    <p className="cp-state">Chargement…</p>
  ) : (
    <ChannelPostWriter
      key={creatorId}
      creatorId={creatorId}
      creatorName={name}
      creators={options}
      onCreator={setCreatorId}
    />
  );
}

function ChannelPostWriter({
  creatorId,
  creatorName,
  creators,
  onCreator,
}: {
  creatorId: string;
  creatorName: string;
  creators: readonly SelectOption<string>[];
  onCreator: (id: string) => void;
}): JSX.Element {
  const channel = useTelegramChannel(creatorId);
  const [kind, setKind] = useState<ChannelPostKind>('post');
  const [media, setMedia] = useState('');
  const [advice, setAdvice] = useState('');
  const [linkChoice, setLinkChoice] = useState<LinkChoice>(CHANNEL_LINK);
  const [writing, setWriting] = useState(false);
  const [tried, setTried] = useState<TriedChannelPost | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // On a phone the preview is under the form: a new post brings it into view.
  const preview = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = preview.current;
    if (tried === null || section === null || typeof section.scrollIntoView !== 'function') return;
    section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [tried]);
  const mediaId = useId();
  const adviceId = useId();

  const config = channel.data?.config;
  const links = config?.links ?? [];
  const channelLink = links.find((one) => one.id === config?.channelLinkId);
  const linkOptions: SelectOption<LinkChoice>[] = [
    {
      value: CHANNEL_LINK,
      label: channelLink === undefined ? 'Sans lien' : `Lien du canal (${channelLink.name})`,
    },
    ...links.filter((one) => one.id !== channelLink?.id).map((one) => ({ value: one.id, label: one.name })),
  ];

  const write = async (): Promise<void> => {
    setWriting(true);
    setFailure(null);
    try {
      setTried(
        await tryChannelPost(creatorId, {
          kind,
          media: kind === 'post' && media.trim() !== '' ? media.trim() : null,
          advice: advice.trim() === '' ? null : advice.trim(),
          linkId: kind === 'post' && linkChoice !== CHANNEL_LINK ? linkChoice : null,
        }),
      );
    } catch (error) {
      setFailure(error instanceof ChannelRefused ? error.message : CHANNEL_ERRORS[channelErrorKind(error)]);
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="cp-page">
      <div className="nv-plate ps-panel">
        <section className="ps-block" aria-labelledby="cp-ask">
          <h3 className="ps-block__title" id="cp-ask">
            Ce qu’elle publie
          </h3>
          <div className="tc-setting tc-setting--select cp-setting">
            <span className="tc-setting__label" aria-hidden="true">
              Créatrice
            </span>
            <Select<string> ariaLabel="Créatrice" value={creatorId} options={creators} onChange={onCreator} />
          </div>
          <div className="tc-setting cp-setting">
            <span className="tc-setting__label" aria-hidden="true">
              Type
            </span>
            <Segment<ChannelPostKind> label="Type" options={KINDS} value={kind} onChange={setKind} />
          </div>
          {kind === 'post' ? (
            <>
              <div className="tc-setting tc-setting--select cp-setting">
                <span className="tc-setting__label" aria-hidden="true">
                  Lien
                </span>
                <Select<LinkChoice>
                  ariaLabel="Lien"
                  value={linkChoice}
                  options={linkOptions}
                  onChange={setLinkChoice}
                  disabled={links.length === 0}
                />
              </div>
              <div className="nv-field ps-field">
                <label className="tc-field-label" htmlFor={mediaId}>
                  Le média
                </label>
                <textarea
                  id={mediaId}
                  className="nv-field__control nv-glass cp-area"
                  rows={2}
                  maxLength={CHANNEL_MEDIA_TEXT_MAX}
                  placeholder="Ce qu’on voit : « selfie au miroir, robe noire »"
                  value={media}
                  onChange={(event) => {
                    setMedia(event.target.value);
                  }}
                />
              </div>
            </>
          ) : (
            <p className="ps-hint">
              Une question et 2 à 4 réponses, sans lien : Telegram n’en met pas sous un sondage.
            </p>
          )}
          <div className="nv-field ps-field">
            <label className="tc-field-label" htmlFor={adviceId}>
              Conseil de l’agence
            </label>
            <textarea
              id={adviceId}
              className="nv-field__control nv-glass cp-area"
              rows={2}
              maxLength={CHANNEL_ADVICE_MAX}
              placeholder="Facultatif : « parle du live de ce soir »"
              value={advice}
              onChange={(event) => {
                setAdvice(event.target.value);
              }}
            />
          </div>
          <button
            type="button"
            className="nv-btn nv-btn--neon ps-self-start"
            disabled={writing}
            onClick={() => {
              void write();
            }}
          >
            {writing ? 'Écriture…' : tried === null ? 'Écrire' : 'Réécrire'}
          </button>
        </section>
      </div>

      <div className="nv-plate ps-panel">
        <section ref={preview} className="ps-block" aria-labelledby="cp-preview" aria-live="polite">
          <h3 className="ps-block__title" id="cp-preview">
            Aperçu
          </h3>
          {failure === null ? null : (
            <p className="ps-error" role="alert">
              {failure}
            </p>
          )}
          {tried === null ? (
            <p className="ps-lead">Le post apparaît ici, comme dans Telegram. Rien n’est publié.</p>
          ) : (
            <Preview tried={tried} creatorName={creatorName} />
          )}
        </section>
      </div>
    </div>
  );
}

function Preview({ tried, creatorName }: { tried: TriedChannelPost; creatorName: string }): JSX.Element {
  const { draft, violations } = tried;
  return (
    <>
      <article className="cp-bubble" aria-label="Le post">
        <p className="cp-bubble__who">{creatorName}</p>
        {draft.kind === 'post' ? (
          <p className="cp-bubble__text">
            {draft.segments.map((segment, rank) =>
              segment.style === 'bold' ? (
                <strong key={rank}>{segment.text}</strong>
              ) : segment.style === 'underline' ? (
                <u key={rank}>{segment.text}</u>
              ) : (
                <span key={rank}>{segment.text}</span>
              ),
            )}
            {draft.link === null ? null : (
              <>
                {'\n\n'}
                <a
                  className="cp-bubble__link"
                  href={draft.link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {draft.link.text}
                </a>
              </>
            )}
          </p>
        ) : (
          <div className="cp-poll">
            <p className="cp-poll__question">{draft.question}</p>
            <p className="cp-poll__kind">Sondage anonyme</p>
            <ul className="cp-poll__options">
              {draft.options.map((option, rank) => (
                <li key={rank} className="cp-poll__option">
                  <span className="cp-poll__dot" aria-hidden="true" />
                  {option}
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>
      {violations.length === 0 ? (
        <p className="ps-hint">Aucune garde levée. Fiche {tried.personaVersion}, rien n’est publié.</p>
      ) : (
        <>
          <ul className="tc-warnings" aria-label="Gardes">
            {violations.map((violation, rank) => (
              <li key={rank} className="tc-warning">
                {violationLabel(violation)}
              </li>
            ))}
          </ul>
          <p className="ps-hint">Fiche {tried.personaVersion}, rien n’est publié.</p>
        </>
      )}
    </>
  );
}
