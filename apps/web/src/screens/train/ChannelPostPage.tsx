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
import { useGrowingArea } from '@/lib/growing-area';
import { Select, type SelectOption } from '@/shell/Select';

import '@/creators/persona/persona.css';
import '@/creators/telegram/telegram-channel.css';
import './channel/channel-post.css';

/**
 * Entraîner › Post du canal (ADR 0080 § 7): her channel's main post, engagement post or poll written as production
 * will write it, with her persona, her examples and where the link leads, then the guards. Nothing is published.
 */

/** The three posts of her channel (ADR 0080 § 5.7, § 5.8), each said in one line under the choice. */
const KINDS = [
  { value: 'main', label: 'Principal' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'poll', label: 'Sondage' },
] as const;
const KIND_HINTS: Readonly<Record<ChannelPostKind, string>> = {
  main: 'Le post du jour qui mène au lien : il réagit au média.',
  engagement: 'Une question, un moment de sa journée, sans lien.',
  poll: 'Une question et 2 à 4 réponses, sans lien.',
};

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
  const [kind, setKind] = useState<ChannelPostKind>('main');
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
          media: kind !== 'poll' && media.trim() !== '' ? media.trim() : null,
          advice: advice.trim() === '' ? null : advice.trim(),
          linkId: kind === 'main' && linkChoice !== CHANNEL_LINK ? linkChoice : null,
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
          <div className="tc-setting cp-setting cp-setting--kind">
            <span className="tc-setting__label" aria-hidden="true">
              Type
            </span>
            <Segment<ChannelPostKind> label="Type" options={KINDS} value={kind} onChange={setKind} />
          </div>
          <p className="ps-hint cp-hint">{KIND_HINTS[kind]}</p>
          {kind === 'main' ? (
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
          ) : null}
          {kind === 'poll' ? null : (
            <GrowingField
              label="Le média"
              value={media}
              maxLength={CHANNEL_MEDIA_TEXT_MAX}
              placeholder="Ce qu’on voit : « selfie au miroir, robe noire »"
              onChange={setMedia}
            />
          )}
          <GrowingField
            label="Conseil de l’agence"
            value={advice}
            maxLength={CHANNEL_ADVICE_MAX}
            placeholder="Facultatif : « parle du live de ce soir »"
            onChange={setAdvice}
          />
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
        <section ref={preview} className="ps-block" aria-labelledby="cp-preview">
          <h3 className="ps-block__title" id="cp-preview">
            Aperçu
          </h3>
          {failure === null ? null : (
            <p className="ps-error" role="alert">
              {failure}
            </p>
          )}
          {/* Read once when a post arrives; a refusal is the alert's alone. */}
          <div className="cp-result" aria-live="polite">
            {tried === null ? (
              <p className="ps-lead">Le post apparaît ici, comme dans Telegram. Rien n’est publié.</p>
            ) : (
              <Preview tried={tried} creatorName={creatorName} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** A text field of the form that grows with its text, on every browser (`useGrowingArea`). */
function GrowingField({
  label,
  value,
  maxLength,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  maxLength: number;
  placeholder: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  const ref = useGrowingArea(value);
  return (
    <div className="nv-field ps-field">
      <label className="tc-field-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        className="nv-field__control nv-glass cp-area"
        rows={2}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
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
