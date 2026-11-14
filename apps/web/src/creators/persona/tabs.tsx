import {
  BANKED_OBJECTION_KINDS,
  DESIRE_BAND_FLOORS,
  KycSlotSchema,
  OBJECTION_KIND_LABELS,
  OBJECTION_REPLIES_MAX,
  OBJECTION_REPLY_MAX_LENGTH,
  PERSONA_BOUNDS,
  PERSONA_EMOJIS_MAX,
  PERSONA_OPTIONS,
  type PersonaAgentRules,
  type PersonaAgentSettings,
  type PersonaFollowUps,
  type PersonaNotifications,
  type PersonaStrategies,
  type BankedObjectionKind,
  type ObjectionReplies,
  type ObjectionReply,
} from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { CodeTag, Entries, Field, Fold, NumberInput, Picker, Segment, SwitchRow, TextArea } from './fields';
import {
  collectOrAll,
  desireHint,
  emojiKey,
  followUpsSummary,
  hoursLabel,
  issuesOf,
  minutesLabel,
  nudgesSummary,
  strategySummaries,
  type FieldIssue,
} from './model';

/**
 * « Réglages de l'agent » (ADR 0079 § 4): what the code applies, block by block, never a question of her sheet. Each
 * block edits its own part of `agent`; its fields read their issues and changes under the same path without `agent.`
 * (`strategies.kyc.max_messages`). The numbers the policy enforces carry « Règle stricte », said once per group
 * (CREA-08): on the title of the block or of the fold that holds the rules, never on each field.
 */

export interface TabProps<T> {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly issues: readonly FieldIssue[];
}

/** Empty text, or only spaces, is « not given » (null) for the optional fields of the schema. */
export const orNull = (text: string): string | null => (text.trim() === '' ? null : text);

type AgentBehavior = PersonaAgentSettings['behavior'];

/** Numbers the policy enforces, side by side, under one title that carries the mark for the group. */
function Coded({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ps-coded">
      <p className="ps-coded__title">
        {title}
        <CodeTag />
      </p>
      {children}
    </div>
  );
}

/**
 * A block of a tab. Its title is a heading in ink above the labels it covers (CREA-17); `code` puts « Règle stricte »
 * on it once, for every field of the block.
 */
export function Block({
  title,
  lead,
  code = false,
  children,
}: {
  title?: string;
  lead?: ReactNode;
  code?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="ps-block">
      {title === undefined ? null : (
        <h3 className="ps-block__title">
          {title}
          {code ? <CodeTag /> : null}
        </h3>
      )}
      {lead === undefined ? null : <p className="ps-lead">{lead}</p>}
      {children}
    </section>
  );
}

/** How she writes, as the code applies it when sending: split messages, her pet names, the delay before answering. */
export function AgentBehaviorTab({ value: b, onChange }: TabProps<AgentBehavior>): JSX.Element {
  const id = useId();
  const set = <F extends keyof AgentBehavior>(field: F, v: AgentBehavior[F]): void => {
    onChange({ ...b, [field]: v });
  };
  return (
    <Block title="Comportement" code>
      <SwitchRow
        label="Découper ses messages"
        path="behavior.split_messages"
        detail="Plusieurs bulles courtes plutôt qu’un long message."
        checked={b.split_messages}
        onChange={(v) => {
          set('split_messages', v);
        }}
      />
      <Field
        label="Surnoms"
        id={`${id}-pet`}
        hint="Les seuls surnoms qu’elle donne aux fans : elle n’en utilise aucun autre."
        path="behavior.pet_names"
      >
        <Entries
          id={`${id}-pet`}
          values={b.pet_names}
          maxLength={30}
          placeholder="Ajouter un surnom"
          onChange={(v) => {
            set('pet_names', v);
          }}
        />
      </Field>
      <Field
        label="Délai avant de répondre"
        id={`${id}-delay`}
        hint="Attendu avant chaque envoi, pour répondre comme une personne."
        path="behavior.response_delay_minutes"
      >
        <NumberInput
          id={`${id}-delay`}
          unit="min"
          bounds={PERSONA_BOUNDS.responseDelayMinutes}
          value={b.response_delay_minutes}
          onChange={(v) => {
            set('response_delay_minutes', v ?? Number.NaN);
          }}
        />
      </Field>
    </Block>
  );
}

type Strategy = PersonaStrategies[keyof PersonaStrategies];

/** Style and instructions, shared by the four strategies: instructions exist only for the custom style. */
function StyleFields<S extends Strategy>({
  value,
  onChange,
  options,
  path,
}: {
  value: S;
  onChange: (value: S) => void;
  options: readonly { readonly value: S['style']; readonly label: string }[];
  path: string;
}): JSX.Element {
  const id = useId();
  return (
    <>
      {/* What the two styles mean is said once, in the lead of the tab (CREA-09). */}
      <Field label="Style" path={`${path}.style`}>
        <Segment
          label="Style"
          options={options}
          value={value.style}
          onChange={(style) => {
            onChange({
              ...value,
              style,
              instructions: style === 'custom' ? (value.instructions ?? '') : null,
            });
          }}
        />
      </Field>
      {value.instructions === null ? null : (
        <div className="ps-reveal">
          <Field
            label="Comment elle doit faire"
            id={id}
            hint="Le ton et la manière, pas les chiffres : ceux-là sont réglés plus bas."
            path={`${path}.instructions`}
          >
            <TextArea
              id={id}
              value={value.instructions}
              maxLength={2000}
              onChange={(instructions) => {
                onChange({ ...value, instructions });
              }}
            />
          </Field>
        </div>
      )}
    </>
  );
}

export function StrategiesTab({ value: s, onChange, issues }: TabProps<PersonaStrategies>): JSX.Element {
  const id = useId();
  const summaries = strategySummaries(s);
  const set = <F extends keyof PersonaStrategies>(field: F, v: PersonaStrategies[F]): void => {
    onChange({ ...s, [field]: v });
  };
  const at = (field: string): FieldIssue[] => issuesOf(issues, `strategies.${field}`);
  const openIf = (field: string): boolean | undefined => (at(field).length > 0 ? true : undefined);
  return (
    <Block
      title="Stratégies"
      lead={
        <>
          Comment elle mène la conversation jusqu’à la vente, étape par étape. Les prix ne se négocient jamais
          : ce n’est pas un réglage. Pour chaque étape, le style par défaut suit la méthode de l’agence ;
          Personnalisé : tu écris comment elle doit faire.
        </>
      }
    >
      <Fold title="Faire connaissance" summary={summaries.kyc} open={openIf('kyc')}>
        <StyleFields
          path="strategies.kyc"
          value={s.kyc}
          options={PERSONA_OPTIONS.strategyStyle}
          onChange={(v) => {
            set('kyc', v);
          }}
        />
        {/* CREA-11, accepted by Charles on 29/10: the list the code applies first, OnlyChat's free text after. */}
        <Field
          label="Infos à collecter"
          id={`${id}-c`}
          hint="Toutes par défaut, dans cet ordre. Une info ajoutée passe en dernier ; celles retirées ne sont jamais demandées au fan."
          path="strategies.kyc.collect"
        >
          <Picker
            id={`${id}-c`}
            label="Infos à collecter"
            options={PERSONA_OPTIONS.kycSlots}
            values={s.kyc.collect ?? KycSlotSchema.options}
            placeholder="Ajouter une info"
            empty="Aucune info de ce nom"
            keepOrder
            onChange={(v) => {
              set('kyc', { ...s.kyc, collect: collectOrAll(v) });
            }}
          />
        </Field>
        <Field
          label="Autre chose à savoir (facultatif)"
          id={`${id}-t`}
          hint="Ce que la liste ne dit pas, en quelques mots."
          path="strategies.kyc.targets"
        >
          <TextArea
            id={`${id}-t`}
            rows={2}
            value={s.kyc.targets ?? ''}
            maxLength={500}
            onChange={(v) => {
              set('kyc', { ...s.kyc, targets: orNull(v) });
            }}
          />
        </Field>
        <Coded title="Limites de temps">
          <div className="ps-grid ps-grid--3">
            <Field label="Au plus, en messages" id={`${id}-m`} path="strategies.kyc.max_messages">
              <NumberInput
                id={`${id}-m`}
                unit="messages"
                bounds={PERSONA_BOUNDS.kycMaxMessages}
                value={s.kyc.max_messages}
                onChange={(v) => {
                  set('kyc', { ...s.kyc, max_messages: v ?? Number.NaN });
                }}
              />
            </Field>
            <Field
              label="Au plus, en temps"
              id={`${id}-d`}
              hint={
                Number.isFinite(s.kyc.max_duration_minutes)
                  ? minutesLabel(s.kyc.max_duration_minutes)
                  : undefined
              }
              path="strategies.kyc.max_duration_minutes"
            >
              <NumberInput
                id={`${id}-d`}
                unit="min"
                bounds={PERSONA_BOUNDS.kycMaxDurationMinutes}
                value={s.kyc.max_duration_minutes}
                onChange={(v) => {
                  set('kyc', { ...s.kyc, max_duration_minutes: v ?? Number.NaN });
                }}
              />
            </Field>
            <Field
              label="S’il chauffe, le suivre après"
              id={`${id}-f`}
              hint="Avant, elle ramène doucement la conversation."
              path="strategies.kyc.min_hours_before_following"
            >
              <NumberInput
                id={`${id}-f`}
                unit="h"
                bounds={PERSONA_BOUNDS.kycMinHoursBeforeFollowing}
                value={s.kyc.min_hours_before_following}
                onChange={(v) => {
                  set('kyc', { ...s.kyc, min_hours_before_following: v ?? Number.NaN });
                }}
              />
            </Field>
          </div>
        </Coded>
      </Fold>

      <Fold title="Sexualisation" code summary={summaries.sexualization} open={openIf('sexualization')}>
        <StyleFields
          path="strategies.sexualization"
          value={s.sexualization}
          options={PERSONA_OPTIONS.strategyStyle}
          onChange={(v) => {
            set('sexualization', v);
          }}
        />
        <Field
          label="Elle lance le sujet après"
          id={`${id}-sx`}
          hint="Temps de relation avec le fan. S’il le lance avant, c’est la règle de « Faire connaissance » qui joue."
          path="strategies.sexualization.initiate_after_hours"
        >
          <NumberInput
            id={`${id}-sx`}
            unit="h"
            bounds={PERSONA_BOUNDS.sexualizationInitiateAfterHours}
            value={s.sexualization.initiate_after_hours}
            onChange={(v) => {
              set('sexualization', { ...s.sexualization, initiate_after_hours: v ?? Number.NaN });
            }}
          />
        </Field>
        <Field
          label="Elle ne l’ouvre qu’à partir d’une note de désir de"
          id={`${id}-sd`}
          hint={desireHint(s.sexualization.min_desire_to_open, DESIRE_BAND_FLOORS.playful)}
          path="strategies.sexualization.min_desire_to_open"
        >
          <NumberInput
            id={`${id}-sd`}
            unit="sur 100"
            nullable
            bounds={PERSONA_BOUNDS.sexualizationMinDesireToOpen}
            value={s.sexualization.min_desire_to_open ?? null}
            onChange={(v) => {
              // Emptied, the default applies: an absent key, which the saved version leaves out.
              set('sexualization', { ...s.sexualization, min_desire_to_open: v ?? undefined });
            }}
          />
        </Field>
      </Fold>

      <Fold
        title="Lancement des scripts"
        code
        summary={summaries.script_launch}
        open={openIf('script_launch')}
      >
        <StyleFields
          path="strategies.script_launch"
          value={s.script_launch}
          options={PERSONA_OPTIONS.scriptLaunchStyle}
          onChange={(v) => {
            set('script_launch', v);
          }}
        />
        <Field
          label="Attendre au moins, avant un nouveau script"
          hint="Pour un même fan."
          id={`${id}-sc`}
          path="strategies.script_launch.cooldown_hours"
        >
          <NumberInput
            id={`${id}-sc`}
            unit="h"
            bounds={PERSONA_BOUNDS.scriptCooldownHours}
            value={s.script_launch.cooldown_hours}
            onChange={(v) => {
              set('script_launch', { ...s.script_launch, cooldown_hours: v ?? Number.NaN });
            }}
          />
        </Field>
        <Field
          label="Un script ne part qu’à partir d’une note de désir de"
          id={`${id}-sm`}
          hint={desireHint(s.script_launch.min_desire, DESIRE_BAND_FLOORS.hot)}
          path="strategies.script_launch.min_desire"
        >
          <NumberInput
            id={`${id}-sm`}
            unit="sur 100"
            nullable
            bounds={PERSONA_BOUNDS.scriptMinDesire}
            value={s.script_launch.min_desire ?? null}
            onChange={(v) => {
              set('script_launch', { ...s.script_launch, min_desire: v ?? undefined });
            }}
          />
        </Field>
      </Fold>

      <Fold title="Suivi d’offre" code summary={summaries.post_offer} open={openIf('post_offer')}>
        <StyleFields
          path="strategies.post_offer"
          value={s.post_offer}
          options={PERSONA_OPTIONS.strategyStyle}
          onChange={(v) => {
            set('post_offer', v);
          }}
        />
        <Field label="Reproposer après un refus" id={`${id}-po`} path="strategies.post_offer.delay_days">
          <NumberInput
            id={`${id}-po`}
            unit="jours"
            bounds={PERSONA_BOUNDS.postOfferDelayDays}
            value={s.post_offer.delay_days}
            onChange={(v) => {
              set('post_offer', { ...s.post_offer, delay_days: v ?? Number.NaN });
            }}
          />
        </Field>
      </Fold>
    </Block>
  );
}

/** Up to five delays, in hours after the fan's last message; kept sorted, so they are always increasing. */
function Delays({
  values,
  onChange,
}: {
  values: readonly number[];
  onChange: (v: number[]) => void;
}): JSX.Element {
  const id = useId();
  const [next, setNext] = useState<number | null>(null);
  const [min, max] = PERSONA_BOUNDS.followUpDelayHours;
  const canAdd =
    next !== null &&
    Number.isInteger(next) &&
    next >= min &&
    next <= max &&
    !values.includes(next) &&
    values.length < 5;
  return (
    <div className="ps-delays">
      {values.map((h) => (
        <span key={h} className="ps-entry">
          <span className="ps-entry__text">{hoursLabel(h)}</span>
          <button
            type="button"
            className="ps-entry__remove"
            aria-label={`Retirer la relance à ${hoursLabel(h)}`}
            onClick={() => {
              onChange(values.filter((v) => v !== h));
            }}
          >
            ×
          </button>
        </span>
      ))}
      {values.length < 5 ? (
        <form
          className="ps-delays__add"
          onSubmit={(event) => {
            event.preventDefault();
            if (next === null || !canAdd) return;
            onChange([...values, next].sort((a, b) => a - b));
            setNext(null);
          }}
        >
          <label className="sr-only" htmlFor={id}>
            Nouvelle relance, en heures
          </label>
          <NumberInput
            id={id}
            nullable
            unit="h"
            bounds={PERSONA_BOUNDS.followUpDelayHours}
            value={next}
            onChange={setNext}
          />
          <button type="submit" className="nv-btn nv-btn--soft nv-btn--sm" disabled={!canAdd}>
            Ajouter
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function FollowUpsTab({ value: f, onChange, issues }: TabProps<PersonaFollowUps>): JSX.Element {
  const id = useId();
  const set = <F extends keyof PersonaFollowUps>(field: F, v: PersonaFollowUps[F]): void => {
    onChange({ ...f, [field]: v });
  };
  const n = f.nudges;
  const setNudge = <F extends keyof typeof n>(field: F, v: (typeof n)[F]): void => {
    set('nudges', { ...n, [field]: v });
  };
  const at = (field: string): FieldIssue[] => issuesOf(issues, `follow_ups.${field}`);
  return (
    <>
      <Block title="Relances" code>
        <SwitchRow
          label="Relancer un fan qui ne répond plus"
          path="follow_ups.enabled"
          detail={followUpsSummary(f)}
          checked={f.enabled}
          onChange={(v) => {
            // Switched off, the type and its text are hidden: a custom text left empty would block the save unseen.
            const unwritten = f.type === 'custom' && (f.text ?? '').trim() === '';
            onChange(!v && unwritten ? { ...f, enabled: v, type: 'soft', text: null } : { ...f, enabled: v });
          }}
        />
        {f.enabled ? (
          <div className="ps-reveal ps-stack">
            <Field
              label="Quand relancer"
              hint="Heures après son dernier message, cinq relances au plus."
              path="follow_ups.delays_hours"
            >
              <Delays
                values={f.delays_hours}
                onChange={(v) => {
                  set('delays_hours', v);
                }}
              />
            </Field>
            <Field
              label="Type de relance"
              hint="Douce : un message léger écrit par l’agent. Personnalisée : il envoie ton texte."
              path="follow_ups.type"
            >
              <Segment
                label="Type de relance"
                options={PERSONA_OPTIONS.followUpType}
                value={f.type}
                onChange={(type) => {
                  onChange({ ...f, type, text: type === 'custom' ? (f.text ?? '') : null });
                }}
              />
            </Field>
            {f.text === null ? null : (
              <div className="ps-reveal">
                <Field label="Texte de la relance" id={`${id}-txt`} path="follow_ups.text">
                  <TextArea
                    id={`${id}-txt`}
                    rows={2}
                    value={f.text}
                    maxLength={500}
                    onChange={(text) => {
                      set('text', text);
                    }}
                  />
                </Field>
              </div>
            )}
          </div>
        ) : null}
      </Block>

      <Fold
        title="Petits rappels"
        summary={nudgesSummary(n)}
        code
        open={at('nudges').length > 0 ? true : undefined}
      >
        <SwitchRow
          label="Envoyer des petits rappels"
          path="follow_ups.nudges.enabled"
          detail="Un mot court quand le fan lit sans répondre."
          checked={n.enabled}
          onChange={(v) => {
            setNudge('enabled', v);
          }}
        />
        <div className="ps-grid ps-grid--3">
          <Field label="Après" id={`${id}-nd`} path="follow_ups.nudges.delay_minutes">
            <NumberInput
              id={`${id}-nd`}
              unit="min"
              bounds={PERSONA_BOUNDS.nudgeDelayMinutes}
              value={n.delay_minutes}
              onChange={(v) => {
                setNudge('delay_minutes', v ?? Number.NaN);
              }}
            />
          </Field>
          <Field label="Par jour au plus" id={`${id}-nm`} path="follow_ups.nudges.max_per_day">
            <NumberInput
              id={`${id}-nm`}
              unit="rappels"
              bounds={PERSONA_BOUNDS.nudgesPerDay}
              value={n.max_per_day}
              onChange={(v) => {
                setNudge('max_per_day', v ?? Number.NaN);
              }}
            />
          </Field>
          <Field
            label="Attendre après une conversation"
            id={`${id}-nh`}
            path="follow_ups.nudges.min_hours_after_conversation"
          >
            <NumberInput
              id={`${id}-nh`}
              unit="h"
              bounds={PERSONA_BOUNDS.nudgeMinHoursAfterConversation}
              value={n.min_hours_after_conversation}
              onChange={(v) => {
                setNudge('min_hours_after_conversation', v ?? Number.NaN);
              }}
            />
          </Field>
        </div>
        <SwitchRow
          label="Effacer le rappel précédent"
          path="follow_ups.nudges.delete_previous"
          detail="Un seul rappel visible à la fois."
          checked={n.delete_previous}
          onChange={(v) => {
            setNudge('delete_previous', v);
          }}
        />
      </Fold>
    </>
  );
}

const NOTIFICATIONS: readonly {
  readonly field: 'sales' | 'agent_disabled' | 'no_script_left' | 'rate_limited';
  readonly label: string;
  readonly detail: string;
}[] = [
  { field: 'sales', label: 'Ventes', detail: 'Chaque achat d’un fan.' },
  {
    field: 'agent_disabled',
    label: 'Agent arrêté',
    detail: 'Quand l’agent s’arrête, pour elle ou pour un fan.',
  },
  {
    field: 'no_script_left',
    label: 'Plus de script à proposer',
    detail: 'Un fan a vu tout ce qu’il y a à vendre.',
  },
  { field: 'rate_limited', label: 'Envois freinés', detail: 'La plateforme ralentit les envois du compte.' },
];

export function NotificationsTab({
  value: v,
  onChange,
  isOwner = false,
}: TabProps<PersonaNotifications> & {
  /** Réglages › Alertes is the owner's: a link for the owner, its name alone for the others. */
  isOwner?: boolean;
}): JSX.Element {
  const id = useId();
  return (
    <>
      <Block
        title="Te prévenir quand"
        lead={
          <>
            Sur les canaux d’alerte, réglés dans{' '}
            {isOwner ? (
              // A route link: it keeps the app, and the « leave without saving? » question, instead of reloading.
              <Link className="ps-link" to="/reglages/alertes">
                Réglages › Alertes
              </Link>
            ) : (
              'Réglages › Alertes par le propriétaire'
            )}
            .
          </>
        }
      >
        <div className="ps-switches">
          {NOTIFICATIONS.map((item) => (
            <SwitchRow
              key={item.field}
              label={item.label}
              detail={item.detail}
              path={`notifications.${item.field}`}
              checked={v[item.field]}
              onChange={(checked) => {
                onChange({ ...v, [item.field]: checked });
              }}
            />
          ))}
        </div>
      </Block>
      <Block title="Mots-clés d’alerte" code>
        <Field
          label="Mots-clés d’alerte"
          labelHidden
          id={`${id}-kw`}
          hint="Toujours actifs : un fan qui en écrit un met l’agent en pause pour lui et prévient un humain."
          path="notifications.alert_keywords"
        >
          <Entries
            id={`${id}-kw`}
            values={v.alert_keywords}
            maxLength={40}
            placeholder="Ajouter un mot-clé"
            onChange={(alert_keywords) => {
              onChange({ ...v, alert_keywords });
            }}
          />
        </Field>
      </Block>
    </>
  );
}

const RULES: readonly {
  readonly field: Exclude<keyof PersonaAgentRules, 'emojis_forbidden'>;
  readonly label: string;
  readonly placeholder: string;
  readonly hint?: string;
  readonly max: number;
}[] = [
  { field: 'never_do', label: 'Ce qu’elle ne fait jamais', placeholder: 'Ajouter une pratique', max: 120 },
  {
    field: 'never_show',
    label: 'Ce qu’elle ne montre jamais',
    placeholder: 'Ajouter ce qu’elle cache',
    max: 120,
  },
  {
    field: 'never_say',
    label: 'Ce qu’elle ne dit jamais',
    placeholder: 'Ajouter un mot ou un sujet',
    max: 120,
  },
  {
    field: 'disgusts',
    label: 'Ses dégoûts',
    // Short enough to stay whole in the field (CREA-29); the rest goes under it.
    placeholder: 'Ajouter un dégoût',
    hint: 'Variantes comprises.',
    max: 120,
  },
];

/**
 * The guards' lists (ADR 0079 § 4): only these are applied word for word. « Zones interdites » of her sheet is free
 * text the model reads, never a guard: a guard does not apply to a sentence.
 */
export function RulesTab({ value: r, onChange }: TabProps<PersonaAgentRules>): JSX.Element {
  const id = useId();
  return (
    <Block
      title="Règles strictes"
      lead="L’agent n’envoie jamais un message qui en franchit une, quoi qu’on lui demande. Seules ces listes sont appliquées à la lettre : « Zones interdites » de sa fiche est lu par le modèle, sans garde."
    >
      {RULES.map((item) => (
        <Field
          key={item.field}
          label={item.label}
          hint={item.hint}
          id={`${id}-${item.field}`}
          path={`rules.${item.field}`}
        >
          <Entries
            id={`${id}-${item.field}`}
            values={r[item.field]}
            maxLength={item.max}
            placeholder={item.placeholder}
            onChange={(values) => {
              onChange({ ...r, [item.field]: values });
            }}
          />
        </Field>
      ))}
      <Field
        label="Émojis qu’elle n’utilise jamais"
        id={`${id}-emojis`}
        hint={`Retirés de chaque message, quoi que l’agent écrive. Un émoji par pastille, ${String(PERSONA_EMOJIS_MAX)} au plus.`}
        path="rules.emojis_forbidden"
      >
        <Entries
          id={`${id}-emojis`}
          values={r.emojis_forbidden}
          maxLength={16}
          keyOf={emojiKey}
          placeholder="Ajouter un émoji"
          onChange={(emojis_forbidden) => {
            onChange({ ...r, emojis_forbidden });
          }}
        />
      </Field>
    </Block>
  );
}

/** An id drawn once for a new reply, never reused: what the journal names, never the text (ADR 0090 § B). */
function newReplyId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => alphabet[byte % 36]).join('');
}

/** The replies of one kind of objection: each one a text to adapt, removable, in the order the agent tries them. */
function ObjectionList({
  kind,
  values,
  onChange,
}: {
  kind: BankedObjectionKind;
  values: readonly ObjectionReply[];
  onChange: (values: ObjectionReply[]) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="ps-replies">
      {values.map((reply, index) => (
        <div key={reply.id} className="ps-reply">
          <label className="sr-only" htmlFor={`${id}-${reply.id}`}>
            {`Réplique ${String(index + 1)} à ${OBJECTION_KIND_LABELS[kind]}`}
          </label>
          <TextArea
            id={`${id}-${reply.id}`}
            rows={2}
            value={reply.text}
            maxLength={OBJECTION_REPLY_MAX_LENGTH}
            invalid={reply.text.trim() === ''}
            placeholder="L’idée de sa réponse, qu’elle dira avec ses mots"
            onChange={(text) => {
              onChange(values.map((r) => (r.id === reply.id ? { ...r, text } : r)));
            }}
          />
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm ps-reply__remove"
            onClick={() => {
              onChange(values.filter((r) => r.id !== reply.id));
            }}
          >
            Retirer
          </button>
        </div>
      ))}
      {values.length < OBJECTION_REPLIES_MAX ? (
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm ps-replies__add"
          onClick={() => {
            onChange([...values, { id: newReplyId(), text: '' }]);
          }}
        >
          Ajouter une réplique
        </button>
      ) : null}
    </div>
  );
}

/**
 * Her replies to a price objection (ADR 0090 § B): a bank per kind of objection, an agency method. The agent picks
 * one when a fan discusses a price, never the same twice to one fan, and says it in her words; it never lowers a price.
 * Only the owner reads it: the others never receive it.
 */
export function ObjectionRepliesTab({ value, onChange }: TabProps<ObjectionReplies>): JSX.Element {
  const id = useId();
  return (
    <Block
      title="Réponses aux objections de prix"
      code
      lead="Quand un fan discute un prix, l’agent prend la première réplique de son cas qu’il n’a jamais reçue et la dit avec ses mots. Il ne baisse jamais un prix. Seul le propriétaire voit ces répliques."
    >
      {BANKED_OBJECTION_KINDS.map((kind) => (
        <Field
          key={kind}
          label={OBJECTION_KIND_LABELS[kind]}
          id={`${id}-${kind}`}
          path={`objection_replies.${kind}`}
        >
          <ObjectionList
            kind={kind}
            values={value[kind] ?? []}
            onChange={(replies) => {
              onChange({ ...value, [kind]: replies });
            }}
          />
        </Field>
      ))}
    </Block>
  );
}
