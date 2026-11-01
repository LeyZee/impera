import {
  PERSONA_BLOCK_LABELS,
  PERSONA_EMOJIS_MAX,
  PERSONA_OPTIONS,
  SAMPLE_REPLIES_MAX,
  type Persona,
  type PersonaCompletion,
  type PersonaWritingStyle,
} from '@nirvana/contracts';
import { useId, type JSX, type ReactNode } from 'react';

import { Choice, Entries, Field, Fold, TextArea, TextInput } from './fields';
import {
  emojiKey,
  IN_DEPTH_BLOCKS,
  intimateOrNone,
  issuesOf,
  lifestyleOrNone,
  repliesOrNone,
  tastesOrNone,
  type FieldIssue,
} from './model';
import { Block, orNull, type TabProps } from './tabs';

/*
 * The blocks of P5-01, one tab each: her life, her tastes, the intimate, how she writes and the answers she would
 * give. None is required and none is written while empty: a version keeps it absent, as before the blocks. What the
 * guards apply (her forbidden emojis) carries « Règle stricte »; the rest feeds the prompt.
 */

const NO_LIFESTYLE = { occupation: null, area: null, routine: null, goals: null };

export function LifestyleTab({ value, onChange }: TabProps<'lifestyle'>): JSX.Element {
  const id = useId();
  const l = value ?? NO_LIFESTYLE;
  const set = (field: keyof typeof NO_LIFESTYLE, text: string): void => {
    onChange(lifestyleOrNone({ ...l, [field]: orNull(text) }));
  };
  return (
    <Block lead="Sa vie loin des fans : ce que l’agent peut raconter de ses journées, sans jamais la situer.">
      <div className="ps-grid">
        <Field
          label="Ce qu’elle fait"
          id={`${id}-o`}
          hint="Études, métier : ce qu’elle en dit."
          path="lifestyle.occupation"
        >
          <TextInput
            id={`${id}-o`}
            value={l.occupation ?? ''}
            maxLength={120}
            placeholder="Étudiante en histoire"
            onChange={(v) => {
              set('occupation', v);
            }}
          />
        </Field>
        <Field
          label="Où elle vit"
          id={`${id}-a`}
          hint="Une région ou les environs d’une ville, jamais une adresse."
          path="lifestyle.area"
        >
          <TextInput
            id={`${id}-a`}
            value={l.area ?? ''}
            maxLength={60}
            placeholder="Région lyonnaise"
            onChange={(v) => {
              set('area', v);
            }}
          />
        </Field>
      </div>
      <Field
        label="Ses journées"
        id={`${id}-r`}
        hint="Cours, travail, soirées, week-ends."
        path="lifestyle.routine"
      >
        <TextArea
          id={`${id}-r`}
          rows={4}
          value={l.routine ?? ''}
          maxLength={1000}
          placeholder="À remplir"
          onChange={(v) => {
            set('routine', v);
          }}
        />
      </Field>
      <Field label="Ses projets" id={`${id}-g`} path="lifestyle.goals">
        <TextArea
          id={`${id}-g`}
          rows={2}
          value={l.goals ?? ''}
          maxLength={500}
          onChange={(v) => {
            set('goals', v);
          }}
        />
      </Field>
    </Block>
  );
}

export function TastesTab({ value, onChange }: TabProps<'tastes'>): JSX.Element {
  const id = useId();
  const t = value ?? { likes: [], dislikes: [] };
  return (
    <Block lead="Ce qu’elle aime et ce qu’elle déteste, hors de l’intime. Un goût ne peut pas être à la fois aimé et détesté.">
      <Field label="Ce qu’elle aime" id={`${id}-l`} path="tastes.likes">
        <Entries
          id={`${id}-l`}
          values={t.likes}
          maxLength={80}
          placeholder="Ajouter un goût"
          onChange={(likes) => {
            onChange(tastesOrNone({ ...t, likes }));
          }}
        />
      </Field>
      <Field label="Ce qu’elle déteste" id={`${id}-d`} path="tastes.dislikes">
        <Entries
          id={`${id}-d`}
          values={t.dislikes}
          maxLength={80}
          placeholder="Ajouter ce qu’elle déteste"
          onChange={(dislikes) => {
            onChange(tastesOrNone({ ...t, dislikes }));
          }}
        />
      </Field>
    </Block>
  );
}

export function IntimateTab({ value, onChange }: TabProps<'intimate'>): JSX.Element {
  const id = useId();
  const i = value ?? { turn_ons: [], fantasies: [], sexting_style: null };
  return (
    <Block lead="Ce qui l’excite et comment elle sexte. Ce qu’elle refuse reste dans Limites, que les gardes appliquent : une envie que ses limites refusent n’est pas enregistrée.">
      <Field label="Ce qui l’excite" id={`${id}-t`} path="intimate.turn_ons">
        <Entries
          id={`${id}-t`}
          values={i.turn_ons}
          maxLength={80}
          placeholder="Ajouter"
          onChange={(turnOns) => {
            onChange(intimateOrNone({ ...i, turn_ons: turnOns }));
          }}
        />
      </Field>
      <Field label="Ses fantasmes" id={`${id}-f`} path="intimate.fantasies">
        <Entries
          id={`${id}-f`}
          values={i.fantasies}
          maxLength={120}
          placeholder="Ajouter un fantasme"
          onChange={(fantasies) => {
            onChange(intimateOrNone({ ...i, fantasies }));
          }}
        />
      </Field>
      <Field label="Comment elle sexte" id={`${id}-s`} path="intimate.sexting_style">
        <TextArea
          id={`${id}-s`}
          rows={4}
          value={i.sexting_style ?? ''}
          maxLength={1000}
          onChange={(v) => {
            onChange(intimateOrNone({ ...i, sexting_style: orNull(v) }));
          }}
        />
      </Field>
    </Block>
  );
}

/**
 * Where a first choice starts the block from: the length and the capitals are required once it exists. Said on the
 * screen before she picks anything, so nothing is chosen behind her back.
 */
export const WRITING_STYLE_START: PersonaWritingStyle = {
  message_length: 'short',
  emojis_preferred: [],
  emojis_forbidden: [],
  punctuation: null,
  capitals: 'normal',
};

export function WritingStyleTab({ value: w, onChange }: TabProps<'writing_style'>): JSX.Element {
  const id = useId();
  const set = <F extends keyof PersonaWritingStyle>(field: F, v: PersonaWritingStyle[F]): void => {
    onChange({ ...(w ?? WRITING_STYLE_START), [field]: v });
  };
  return (
    <Block
      lead={
        w === undefined
          ? 'Pas encore décrit. Le premier choix crée ce bloc avec des messages courts et des majuscules comme tout le monde, à changer ici.'
          : 'Comment elle écrit. Les emojis qu’elle n’utilise jamais sont retirés par les gardes, quoi que l’agent écrive.'
      }
    >
      <Field label="Ses messages" path="writing_style.message_length">
        <Choice
          label="Longueur de ses messages"
          options={PERSONA_OPTIONS.messageLength}
          value={w?.message_length ?? null}
          onChange={(v) => {
            if (v !== null) set('message_length', v);
          }}
        />
      </Field>
      <Field label="Les majuscules" path="writing_style.capitals">
        <Choice
          label="Les majuscules"
          options={PERSONA_OPTIONS.capitals}
          value={w?.capitals ?? null}
          onChange={(v) => {
            if (v !== null) set('capitals', v);
          }}
        />
      </Field>
      <Field
        label="Ses emojis"
        id={`${id}-p`}
        hint={`Un emoji par pastille, ${String(PERSONA_EMOJIS_MAX)} au plus.`}
        path="writing_style.emojis_preferred"
      >
        <Entries
          id={`${id}-p`}
          values={w?.emojis_preferred ?? []}
          maxLength={16}
          keyOf={emojiKey}
          placeholder="Ajouter un emoji"
          onChange={(list) => {
            set('emojis_preferred', list);
          }}
        />
      </Field>
      <Field
        label="Les emojis qu’elle n’utilise jamais"
        id={`${id}-x`}
        code
        hint="Un emoji ne peut pas être à la fois dans les deux listes."
        path="writing_style.emojis_forbidden"
      >
        <Entries
          id={`${id}-x`}
          values={w?.emojis_forbidden ?? []}
          maxLength={16}
          keyOf={emojiKey}
          placeholder="Ajouter un emoji"
          onChange={(list) => {
            set('emojis_forbidden', list);
          }}
        />
      </Field>
      <Field
        label="Sa ponctuation"
        id={`${id}-u`}
        hint="Points de suspension, points d’exclamation, ce qu’elle évite."
        path="writing_style.punctuation"
      >
        <TextArea
          id={`${id}-u`}
          rows={2}
          value={w?.punctuation ?? ''}
          maxLength={300}
          onChange={(v) => {
            set('punctuation', orNull(v));
          }}
        />
      </Field>
      {w === undefined ? null : (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm ps-self-start"
          onClick={() => {
            onChange(undefined);
          }}
        >
          Effacer ce bloc
        </button>
      )}
    </Block>
  );
}

const ordinal = (index: number): string => (index === 0 ? '1re' : `${String(index + 1)}e`);

export function SampleRepliesTab({ value, onChange }: TabProps<'sample_replies'>): JSX.Element {
  const id = useId();
  const list = value ?? [];
  const put = (index: number, reply: (typeof list)[number]): void => {
    onChange(list.map((one, at) => (at === index ? reply : one)));
  };
  return (
    <Block lead="Des réponses qu’elle écrirait, inventées : l’agent y lit sa voix, jamais un texte à recopier. Une réponse que les gardes bloqueraient est refusée à l’enregistrement.">
      {list.length === 0 ? (
        <p className="ps-muted">Aucune réponse type pour l’instant. Trois suffisent pour donner le ton.</p>
      ) : null}
      <ol className="ps-replies">
        {list.map((reply, index) => (
          <li key={index} className="ps-reply">
            <div className="ps-reply__fields">
              <Field
                label={`Situation de la ${ordinal(index)} réponse`}
                id={`${id}-${String(index)}-s`}
                hint="Facultatif : à quoi elle répond."
                path={`sample_replies.${String(index)}.situation`}
              >
                <TextInput
                  id={`${id}-${String(index)}-s`}
                  value={reply.situation ?? ''}
                  maxLength={200}
                  placeholder="Il lui demande comment s’est passée sa journée"
                  onChange={(v) => {
                    put(index, { ...reply, situation: orNull(v) });
                  }}
                />
              </Field>
              <Field
                label="Sa réponse"
                id={`${id}-${String(index)}-r`}
                path={`sample_replies.${String(index)}.reply`}
              >
                <TextArea
                  id={`${id}-${String(index)}-r`}
                  rows={2}
                  value={reply.reply}
                  maxLength={500}
                  onChange={(v) => {
                    put(index, { ...reply, reply: v });
                  }}
                />
              </Field>
            </div>
            {reply.reply.trim() === '' ? null : (
              <div className="nv-thread ps-reply__preview" aria-label="Aperçu">
                <p className="nv-bubble nv-bubble--creator">{reply.reply.trim()}</p>
              </div>
            )}
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm ps-self-start"
              aria-label={`Retirer la ${ordinal(index)} réponse`}
              onClick={() => {
                onChange(repliesOrNone(list.filter((_, at) => at !== index)));
              }}
            >
              Retirer
            </button>
          </li>
        ))}
      </ol>
      {list.length >= SAMPLE_REPLIES_MAX ? (
        <p className="ps-muted">
          {String(SAMPLE_REPLIES_MAX)} réponses au plus : retire-en une pour en ajouter une autre.
        </p>
      ) : (
        <button
          type="button"
          className="nv-btn nv-btn--soft ps-self-start"
          onClick={() => {
            onChange([...list, { situation: null, reply: '' }]);
          }}
        >
          Ajouter une réponse type
        </button>
      )}
    </Block>
  );
}

/** How many sample replies she wrote, for a summary: « 3 réponses types ». */
export const repliesLine = (list: Persona['sample_replies']): string => {
  const n = list?.length ?? 0;
  return n === 0 ? 'Aucune' : `${String(n)} réponse${n > 1 ? 's' : ''} type${n > 1 ? 's' : ''}`;
};

/**
 * « Elle en détail » (CREA-02, accepted by Charles on 29/10): the five P5-01 blocks in one tab, each folded behind
 * its name and a line that says where it stands. None is required; a block with a field to fix opens by itself.
 */
export function InDepthTab({
  issues,
  missing,
  sections,
}: {
  issues: readonly FieldIssue[];
  missing: PersonaCompletion['missing'];
  sections: Record<(typeof IN_DEPTH_BLOCKS)[number], ReactNode>;
}): JSX.Element {
  return (
    <>
      <p className="ps-lead ps-in-depth__lead">
        Pour aller plus loin que les Détails : sa vie, ses goûts, l’intime, sa façon d’écrire et des réponses
        types. Rien n’est obligatoire, et ces blocs remplacent peu à peu Infos en plus.
      </p>
      {IN_DEPTH_BLOCKS.map((block) => {
        const toFix = issuesOf(issues, block).length;
        const summary =
          toFix > 0
            ? `${String(toFix)} à corriger`
            : missing.some((m) => m.block === block)
              ? 'À compléter'
              : 'Complet';
        return (
          <Fold key={block} title={PERSONA_BLOCK_LABELS[block]} summary={summary} open={toFix > 0}>
            <div className="ps-in-depth__body" data-path={block}>
              {sections[block]}
            </div>
          </Fold>
        );
      })}
    </>
  );
}
