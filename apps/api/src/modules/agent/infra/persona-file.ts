import {
  ageOn,
  asPersonaV2,
  KYC_SLOT_LABELS,
  KycSlotSchema,
  PERSONA_OPTIONS,
  PERSONA_SHEET,
  sectionAnswers,
  StoredPersonaSchema,
  type KycSlot,
  type PersonaSheet,
  type PersonaStrategies,
  type StoredPersona,
} from '@impera/contracts';
import { parse, stringify } from 'yaml';

import { DEFAULT_MIN_DESIRE_TO_OPEN, DEFAULT_SCRIPT_MIN_DESIRE } from '../domain/desire';
import { DEFAULT_GUARD_SETTINGS, type GuardSettings } from '../domain/guards';
import type { OfferLimits } from '../domain/policy';
import type { SexualizationLimits } from '../domain/sexualization';

/** Who she is for the models, read from the persona YAML: the playground and the drafts share it. */
export interface PersonaForModels {
  /** Her persona version it was read from, when read from the base: written on each draft it writes (ADR 0019). */
  readonly versionId?: string;
  readonly creatorName: string;
  readonly personaSheet: string;
  readonly forbiddenTerms: readonly string[];
  /**
   * Her pace of scripts and the heat they wait for (`agent.strategies.script_launch`), applied by `offerDecision`, never by a
   * prompt.
   */
  readonly offerLimits: OfferLimits;
  /** When she opens sexualization or follows him there (`strategies.sexualization`, `strategies.kyc`), applied by code. */
  readonly sexualizationLimits: SexualizationLimits;
  /**
   * Her follow-ups on his silence (`follow_ups`), scheduled and decided by code: the delays in hours after his last
   * message, none when she has them off, and the spirit of hers when her type is « custom ».
   */
  readonly followUps: { readonly delaysHours: readonly number[]; readonly spirit: string | null };
  /** False: her answer goes out as one message, whatever the voice wrote (`behavior.split_messages`). */
  readonly splitMessages: boolean;
  /** The only pet names she gives fans (`behavior.pet_names`); a guard flags any other. */
  readonly petNames: readonly string[];
  /** Her alert keywords (`notifications.alert_keywords`): one written by a fan pauses the agent for him (P4-01). */
  readonly alertKeywords: readonly string[];
  /** Emojis she never uses (`agent.rules.emojis_forbidden`): a guard blocks them. */
  readonly forbiddenEmojis: readonly string[];
  /** The canvas lines she tries to learn of each fan, in her order (`strategies.kyc.collect`, P5-01). */
  readonly kycSlots: readonly KycSlot[];
}

const isPlaceholder = (value: string): boolean => value.startsWith('<');

/** Her own way to run each stage, when she wrote one: numbers stay out (code applies them). */
function approach(strategies: PersonaStrategies): Record<string, Record<string, string>> {
  const stages = {
    kyc: { instructions: strategies.kyc.instructions, targets: strategies.kyc.targets },
    sexualization: { instructions: strategies.sexualization.instructions },
    script_launch: { instructions: strategies.script_launch.instructions },
    post_offer: { instructions: strategies.post_offer.instructions },
  };
  const written: Record<string, Record<string, string>> = {};
  for (const [stage, fields] of Object.entries(stages)) {
    const kept = Object.fromEntries(
      Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== null),
    );
    if (Object.keys(kept).length > 0) written[stage] = kept;
  }
  return written;
}

const LANGUAGE_LABELS = new Map<string, string>(PERSONA_OPTIONS.languages.map((o) => [o.value, o.label]));

/**
 * Her answers as the model reads them (ADR 0079 § 3): each panel under Desirali's title, each answer under its label,
 * in the sheet's order. Left out: what she left empty or as a placeholder, and the time zone, which is the creator's
 * own; the birth date gives way to her age on `today`.
 */
function sheetForModels(
  sheet: PersonaSheet,
  today: string,
  omitted: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const section of PERSONA_SHEET) {
    const answers = sectionAnswers(sheet, section.key);
    const shown: Record<string, unknown> = {};
    for (const question of section.questions) {
      if (question.key === 'timezone' || omitted.has(question.key)) continue;
      const value = answers[question.key];
      if (value === null || value === undefined) continue;
      if (question.key === 'birth_date' && typeof value === 'string') {
        shown['Âge'] = ageOn(value, today);
      } else if (question.key === 'spoken_languages' && Array.isArray(value)) {
        shown[question.label] = value.map((language: string) => LANGUAGE_LABELS.get(language) ?? language);
      } else if (typeof value !== 'string' || !isPlaceholder(value)) {
        shown[question.label] = value;
      }
    }
    if (Object.keys(shown).length === 0) continue;
    // The last panel has no title on Desirali's screen: its one answer stands on its own.
    if (section.title === null) Object.assign(out, shown);
    else out[section.title] = shown;
  }
  return out;
}

/**
 * Reads a persona YAML, at either format (docs/reference/persona-schema.md); a format-1 file is read through its
 * conversion. The sheet given to the models holds who she is, how she writes and how she likes to run each stage;
 * delays, cooldowns, follow-ups and notifications stay out of it, since code applies them (CLAUDE.md rule 3).
 */
export function readPersonaFile(source: string, fallbackName: string, today: string): PersonaForModels {
  return personaForModels(StoredPersonaSchema.parse(parse(source)), fallbackName, today);
}

/**
 * The same reading for a persona already parsed: her active version stored in `persona_versions`, read by the
 * agent at each draft. `fallbackName` stands in for a nickname still left as a placeholder.
 */
export function personaForModels(
  stored: StoredPersona,
  fallbackName: string,
  today: string,
  /** Answers of the sheet left out of what the model reads (a public post reads none of her intimacy). */
  omitted: ReadonlySet<string> = new Set(),
): PersonaForModels {
  const { sheet, agent } = asPersonaV2(stored);
  const name = sheet.identity.nickname;
  const strategies = approach(agent.strategies);
  const rules = agent.rules;
  const kycSlots = agent.strategies.kyc.collect ?? KycSlotSchema.options;
  const forModels = {
    ...sheetForModels(sheet, today, omitted),
    // Réglages de l'agent the prompts name by key: code applies them, the model is told them so as not to go against.
    behavior: {
      split_messages: agent.behavior.split_messages,
      pet_names: agent.behavior.pet_names.filter((term) => !isPlaceholder(term)),
    },
    ...(Object.keys(strategies).length > 0 && { strategies }),
    // The canvas lines the brain may name in `kycMissing`: hers, in her order (P5-01).
    kyc_collect: kycSlots.map((slot) => KYC_SLOT_LABELS[slot]),
    limits: {
      never_do: rules.never_do,
      never_show: rules.never_show,
      never_say: rules.never_say,
      disgusts: rules.disgusts,
      ...(rules.emojis_forbidden.length > 0 && { emojis_forbidden: rules.emojis_forbidden }),
    },
  };
  return {
    creatorName: isPlaceholder(name) ? fallbackName : name,
    personaSheet: stringify(forModels).trim(),
    forbiddenTerms: [...rules.disgusts, ...rules.never_say].filter((term) => !isPlaceholder(term)),
    offerLimits: {
      cooldownHours: agent.strategies.script_launch.cooldown_hours,
      minDesire: agent.strategies.script_launch.min_desire ?? DEFAULT_SCRIPT_MIN_DESIRE,
    },
    sexualizationLimits: {
      initiateAfterHours: agent.strategies.sexualization.initiate_after_hours,
      minHoursBeforeFollowing: agent.strategies.kyc.min_hours_before_following,
      minDesireToOpen: agent.strategies.sexualization.min_desire_to_open ?? DEFAULT_MIN_DESIRE_TO_OPEN,
    },
    followUps: {
      delaysHours: agent.follow_ups.enabled ? agent.follow_ups.delays_hours : [],
      spirit: agent.follow_ups.text,
    },
    splitMessages: agent.behavior.split_messages,
    petNames: agent.behavior.pet_names.filter((term) => !isPlaceholder(term)),
    alertKeywords: agent.notifications.alert_keywords.filter((term) => !isPlaceholder(term)),
    forbiddenEmojis: rules.emojis_forbidden,
    kycSlots,
  };
}

/** The guards with her disgusts, her forbidden words and emojis, and her pet names. */
export function guardSettingsOf(persona: PersonaForModels): GuardSettings {
  return {
    ...DEFAULT_GUARD_SETTINGS,
    forbiddenTerms: persona.forbiddenTerms,
    forbiddenEmojis: persona.forbiddenEmojis,
    ...(persona.petNames.length > 0 && { petNames: persona.petNames }),
  };
}
