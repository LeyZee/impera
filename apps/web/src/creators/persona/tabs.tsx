import {
  ADDITIONAL_INFO_MAX,
  ageOn,
  DESIRE_BAND_FLOORS,
  KycSlotSchema,
  PERSONA_BOUNDS,
  PERSONA_OPTIONS,
  type Persona,
  type PersonaStrategies,
} from '@nirvana/contracts';
import { Link } from '@tanstack/react-router';
import { useId, useState, type JSX, type ReactNode } from 'react';

import {
  Choice,
  CodeTag,
  Entries,
  Field,
  Fold,
  NumberInput,
  Picker,
  Segment,
  SwitchRow,
  TextArea,
  TextInput,
} from './fields';
import {
  collectOrAll,
  desireHint,
  followUpsSummary,
  hoursLabel,
  issuesOf,
  localDay,
  localTime,
  minutesLabel,
  nudgesSummary,
  physiqueSummary,
  strategySummaries,
  type BlockId,
  type FieldIssue,
} from './model';

import { cityOf } from '@/scheduling/time';

/**
 * One component per tab, in OnlyChat's order. Each edits its own section of the draft; the numbers the policy
 * enforces carry « Règle stricte », the rest feeds the prompt. Nothing here decides: the schema does. The mark is
 * said once per group (CREA-08): on the title of the block or of the fold that holds the rules, never on each field.
 */

export interface TabProps<K extends BlockId> {
  readonly value: Persona[K];
  readonly onChange: (value: Persona[K]) => void;
  readonly issues: readonly FieldIssue[];
}

/** Empty text, or only spaces, is « not given » (null) for the optional fields of the schema. */
export const orNull = (text: string): string | null => (text.trim() === '' ? null : text);

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

/** « 26 ans aujourd’hui », on the local calendar of today; nothing for a date not yet whole or still to come. */
export function ageLine(dateOfBirth: string, today: string = localDay()): string | undefined {
  try {
    const age = ageOn(dateOfBirth, today);
    return age >= 0 ? `${String(age)} ans aujourd’hui` : undefined;
  } catch {
    return undefined;
  }
}

export function DetailsTab({
  value: d,
  onChange,
  issues,
  timezone,
  isOwner = false,
}: TabProps<'details'> & {
  /** The creator's own zone (`creators.timezone`), the one the code goes by; the persona's is a copy for the model. */
  timezone: string | null;
  /** Only the owner changes it, in Heures d'activité: the others are not sent where they cannot go. */
  isOwner?: boolean;
}): JSX.Element {
  const id = useId();
  const zone = timezone ?? d.timezone;
  const set = <F extends keyof Persona['details']>(field: F, v: Persona['details'][F]): void => {
    onChange({ ...d, [field]: v });
  };
  const physiqueIssues = ['height_cm', 'weight_kg', 'shoe_size_eu', 'hair', 'eyes', 'bra'].some(
    (field) => issuesOf(issues, `details.${field}`).length > 0,
  );
  return (
    <>
      <Block title="Qui elle est">
        <div className="ps-grid">
          <Field label="Prénom" id={`${id}-name`} path="details.first_name">
            <TextInput
              id={`${id}-name`}
              value={d.first_name}
              maxLength={40}
              onChange={(v) => {
                set('first_name', v);
              }}
            />
          </Field>
          <Field
            label="Date de naissance"
            id={`${id}-dob`}
            hint={ageLine(d.date_of_birth)}
            path="details.date_of_birth"
          >
            <TextInput
              id={`${id}-dob`}
              type="date"
              value={d.date_of_birth}
              onChange={(v) => {
                set('date_of_birth', v);
              }}
            />
          </Field>
        </div>
        <Field label="Origine" path="details.ethnicity">
          <Choice
            label="Origine"
            options={PERSONA_OPTIONS.ethnicity}
            value={d.ethnicity}
            onChange={(v) => {
              if (v !== null) set('ethnicity', v);
            }}
          />
        </Field>
        <Field
          label="Langues parlées"
          id={`${id}-languages`}
          hint="Celles dans lesquelles elle écrit à ses fans."
          path="details.languages"
        >
          <Picker
            id={`${id}-languages`}
            label="Langues parlées"
            placeholder="Choisir une ou plusieurs langues"
            empty="Aucune langue ne correspond"
            options={PERSONA_OPTIONS.languages}
            values={d.languages}
            onChange={(v) => {
              set('languages', v);
            }}
          />
        </Field>
        {/* Not a field: it does not change here. A line of text, her city and her hour (CREA-27). */}
        <Field
          label="Fuseau horaire"
          hint={
            isOwner
              ? 'Celui de la créatrice, à changer dans Heures d’activité. Il dit à l’agent s’il fait jour ou nuit chez elle.'
              : 'Celui de la créatrice. Il dit à l’agent s’il fait jour ou nuit chez elle.'
          }
          path="details.timezone"
        >
          <p className="ps-static-line" title={zone}>
            {cityOf(zone)} · {localTime(zone)} chez elle
          </p>
        </Field>
      </Block>

      <Block title="Passions et caractère">
        <Field label="Passions" id={`${id}-hob`} path="details.hobbies">
          <Entries
            id={`${id}-hob`}
            values={d.hobbies}
            maxLength={80}
            placeholder="Ajouter une passion"
            onChange={(v) => {
              set('hobbies', v);
            }}
          />
        </Field>
        <Field label="Personnalité" id={`${id}-per`} path="details.personality">
          <Entries
            id={`${id}-per`}
            values={d.personality}
            maxLength={80}
            placeholder="Ajouter un trait"
            onChange={(v) => {
              set('personality', v);
            }}
          />
        </Field>
      </Block>

      <Fold title="Physique" summary={physiqueSummary(d)} open={physiqueIssues ? true : undefined}>
        <div className="ps-grid ps-grid--3">
          <Field label="Taille" id={`${id}-h`} path="details.height_cm">
            <NumberInput
              id={`${id}-h`}
              nullable
              unit="cm"
              bounds={PERSONA_BOUNDS.heightCm}
              value={d.height_cm}
              onChange={(v) => {
                set('height_cm', v);
              }}
            />
          </Field>
          <Field label="Poids" id={`${id}-w`} path="details.weight_kg">
            <NumberInput
              id={`${id}-w`}
              nullable
              unit="kg"
              bounds={PERSONA_BOUNDS.weightKg}
              value={d.weight_kg}
              onChange={(v) => {
                set('weight_kg', v);
              }}
            />
          </Field>
          <Field label="Pointure" id={`${id}-s`} path="details.shoe_size_eu">
            <NumberInput
              id={`${id}-s`}
              nullable
              unit="EU"
              bounds={PERSONA_BOUNDS.shoeSizeEu}
              value={d.shoe_size_eu}
              onChange={(v) => {
                set('shoe_size_eu', v);
              }}
            />
          </Field>
        </div>
        <Field label="Cheveux" path="details.hair">
          <Choice
            label="Cheveux"
            none="Non précisé"
            options={PERSONA_OPTIONS.hair}
            value={d.hair}
            onChange={(v) => {
              set('hair', v);
            }}
          />
        </Field>
        <Field label="Yeux" path="details.eyes">
          <Choice
            label="Yeux"
            none="Non précisé"
            options={PERSONA_OPTIONS.eyes}
            value={d.eyes}
            onChange={(v) => {
              set('eyes', v);
            }}
          />
        </Field>
        <Field label="Tour de poitrine" path="details.bra">
          <Choice
            label="Tour de poitrine"
            none="Non précisé"
            options={PERSONA_OPTIONS.band}
            value={d.bra?.band ?? null}
            onChange={(band) => {
              set('bra', band === null ? null : { band, cup: d.bra?.cup ?? 'B' });
            }}
          />
        </Field>
        {d.bra === null ? null : (
          <Field label="Bonnet" path="details.bra.cup">
            <Choice
              label="Bonnet"
              options={PERSONA_OPTIONS.cup}
              value={d.bra.cup}
              onChange={(cup) => {
                if (cup !== null && d.bra !== null) set('bra', { ...d.bra, cup });
              }}
            />
          </Field>
        )}
      </Fold>
    </>
  );
}

export function AdditionalInfoTab({ value, onChange }: TabProps<'additional_info'>): JSX.Element {
  const id = useId();
  return (
    // CREA-12, accepted by Charles on 29/10: what the other tabs do not say yet, never the same thing twice.
    <Block lead="Ce que les autres onglets ne disent pas encore. L’agent le lit avant chaque réponse.">
      <Field label="Infos en plus" labelHidden id={id} path="additional_info">
        <TextArea id={id} rows={16} value={value} maxLength={ADDITIONAL_INFO_MAX} onChange={onChange} />
      </Field>
    </Block>
  );
}

export function BehaviorTab({ value: b, onChange }: TabProps<'behavior'>): JSX.Element {
  const id = useId();
  const set = <F extends keyof Persona['behavior']>(field: F, v: Persona['behavior'][F]): void => {
    onChange({ ...b, [field]: v });
  };
  return (
    <>
      <Block title="Comment elle écrit">
        <Field label="Style de langage" path="behavior.language_style">
          <Segment
            label="Style de langage"
            options={PERSONA_OPTIONS.languageStyle}
            value={b.language_style}
            onChange={(v) => {
              set('language_style', v);
            }}
          />
        </Field>
        <Field
          label="Consignes de langage"
          id={`${id}-li`}
          hint="Facultatif : tics, ponctuation, emojis, ce qu’elle n’écrit jamais."
          path="behavior.language_instructions"
        >
          <TextArea
            id={`${id}-li`}
            value={b.language_instructions ?? ''}
            maxLength={2000}
            onChange={(v) => {
              set('language_instructions', orNull(v));
            }}
          />
        </Field>
        <SwitchRow
          label="Découper ses messages"
          path="behavior.split_messages"
          detail="Plusieurs bulles courtes plutôt qu’un long message."
          checked={b.split_messages}
          onChange={(v) => {
            set('split_messages', v);
          }}
        />
      </Block>
      <Block title="Règles strictes">
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
    </>
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

export function StrategiesTab({ value: s, onChange, issues }: TabProps<'strategies'>): JSX.Element {
  const id = useId();
  const summaries = strategySummaries(s);
  const set = <F extends keyof PersonaStrategies>(field: F, v: PersonaStrategies[F]): void => {
    onChange({ ...s, [field]: v });
  };
  const at = (field: string): FieldIssue[] => issuesOf(issues, `strategies.${field}`);
  const openIf = (field: string): boolean | undefined => (at(field).length > 0 ? true : undefined);
  return (
    <Block
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

export function FollowUpsTab({ value: f, onChange, issues }: TabProps<'follow_ups'>): JSX.Element {
  const id = useId();
  const set = <F extends keyof Persona['follow_ups']>(field: F, v: Persona['follow_ups'][F]): void => {
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
}: TabProps<'notifications'> & {
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

const LIMITS: readonly {
  readonly field: keyof Persona['limits'];
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

export function LimitsTab({ value: l, onChange }: TabProps<'limits'>): JSX.Element {
  const id = useId();
  return (
    <Block
      title="Règles strictes"
      lead="L’agent n’envoie jamais un message qui en franchit une, quoi qu’on lui demande."
    >
      {LIMITS.map((item) => (
        <Field
          key={item.field}
          label={item.label}
          hint={item.hint}
          id={`${id}-${item.field}`}
          path={`limits.${item.field}`}
        >
          <Entries
            id={`${id}-${item.field}`}
            values={l[item.field]}
            maxLength={item.max}
            placeholder={item.placeholder}
            onChange={(values) => {
              onChange({ ...l, [item.field]: values });
            }}
          />
        </Field>
      ))}
    </Block>
  );
}
