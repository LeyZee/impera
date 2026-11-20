import type {
  MediaDescriptionId,
  PlatformMediaDescriptionView,
  PlatformScriptViewDto,
  ScriptEnergy,
} from '@impera/contracts';

/**
 * « Ses scripts dans Reveal » (ADR 0030 § 3, ADR 0099 § 4, SC-04 lot c8): what keeps each of her Reveal scripts from
 * being offered by the agent, said as the next gesture, and what the agency validates on it, its media's descriptions
 * then its identity. Pure, so that what the screen offers is tested without it.
 */

type StepMedia = PlatformScriptViewDto['steps'][number]['media'][number];

/** A media to read before it is validated, with the description shown for it. */
export interface MediaToValidate {
  readonly ref: string;
  readonly kind: StepMedia['kind'];
  /** The step it is sold or teased in, counted from 1 in the script's order. */
  readonly step: number;
  /** Its place among that step's media (sold, then previews), counted from 1, and how many the step has. */
  readonly place: number;
  readonly of: number;
  readonly description: PlatformMediaDescriptionView;
}

/**
 * Each description shown and not yet validated, once, in the script's order: each step's sold media, then its
 * previews. A media in two steps is read once, at its first.
 */
export function mediaToValidate(script: PlatformScriptViewDto): readonly MediaToValidate[] {
  const seen = new Set<string>();
  const out: MediaToValidate[] = [];
  script.steps.forEach((step, index) => {
    const all = [...step.media, ...step.previewMedia];
    all.forEach((media, at) => {
      const description = media.description;
      if (description === null || description.validated || seen.has(description.id)) return;
      seen.add(description.id);
      out.push({
        ref: media.ref,
        kind: media.kind,
        step: index + 1,
        place: at + 1,
        of: all.length,
        description,
      });
    });
  });
  return out;
}

/** Where it is in the script: « Étape 2 · Photo », « Étape 2 · Photo 1 sur 2 » when the step has more than one. */
export function placeOf(media: MediaToValidate): string {
  const kind = media.kind === 'video' ? 'Vidéo' : media.kind === 'audio' ? 'Vocal' : 'Photo';
  const where = media.of > 1 ? ` ${String(media.place)} sur ${String(media.of)}` : '';
  return `Étape ${String(media.step)} · ${kind}${where}`;
}

/** What « Tout valider » validates: each one with nothing holding it back; one with a reason is read alone. */
export function batchOf(media: readonly MediaToValidate[]): readonly MediaDescriptionId[] {
  return media
    .filter((each) => each.description.reviewReasons.length === 0)
    .map((each) => each.description.id);
}

export type RevealTone = 'ok' | 'todo' | 'wait' | 'warn';

/** Where a script stands, as one short line: the next gesture, and which part of its sheet it opens on. */
export interface RevealStanding {
  readonly tone: RevealTone;
  readonly label: string;
  readonly line: string;
  readonly opens: 'descriptions' | 'identity' | null;
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

const BRANCH_GAPS: ReadonlySet<string> = new Set([
  'branch_unsettled',
  'branch_two_defaults',
  'branch_cheaper_on_spend',
  'branch_previous_unknown',
]);

/**
 * The first thing that keeps it from being offered, in the order it is undone: what Reveal must change, what the vault
 * lacks, the descriptions to read, then its identity. Nothing missing: « Prêt à proposer ».
 */
export function revealStanding(script: PlatformScriptViewDto): RevealStanding {
  const gaps = new Set<string>(script.gaps);
  const media = script.steps.flatMap((step) => [...step.media, ...step.previewMedia]);
  if (gaps.has('step_discounted'))
    return {
      tone: 'warn',
      label: 'Bloqué',
      line: 'Une étape a un « Tarif réduit » dans Reveal : retire-le pour qu’il soit proposé.',
      opens: null,
    };
  if ([...gaps].some((gap) => BRANCH_GAPS.has(gap)))
    return {
      tone: 'warn',
      label: 'Bloqué',
      line: 'Une étape a plusieurs branches : leurs conditions sont à régler.',
      opens: null,
    };
  if (gaps.has('media_twice'))
    return {
      tone: 'warn',
      label: 'Bloqué',
      line: 'Un même média est vendu deux fois : corrige le script dans Reveal.',
      opens: null,
    };
  if (gaps.has('media_absent')) {
    const absent = new Set(media.filter((each) => !each.inVault).map((each) => each.ref)).size;
    return {
      tone: 'wait',
      label: 'En attente',
      line: `${plural(absent, 'média absent', 'médias absents')} du coffre : synchronise-le.`,
      opens: null,
    };
  }
  if (gaps.has('media_not_imported')) {
    const out = new Set(media.filter((each) => !each.imported).map((each) => each.ref)).size;
    return {
      tone: 'todo',
      label: 'À importer',
      line: `${plural(out, 'média à importer', 'médias à importer')} : coche son dossier dans le coffre.`,
      opens: null,
    };
  }
  const toRead = mediaToValidate(script).length;
  if (toRead > 0)
    return {
      tone: 'todo',
      label: 'À valider',
      line: `${plural(toRead, 'description à valider', 'descriptions à valider')}.`,
      opens: 'descriptions',
    };
  if (gaps.has('media_not_described')) {
    const bare = new Set(
      media.filter((each) => each.kind !== 'audio' && each.description === null).map((each) => each.ref),
    ).size;
    return {
      tone: 'wait',
      label: 'À décrire',
      line: `${plural(bare, 'média à décrire', 'médias à décrire')} : « Décrire par IA » dans le coffre.`,
      opens: null,
    };
  }
  if (script.identity === null)
    return { tone: 'wait', label: 'En cours', line: 'L’IA écrit son identité.', opens: null };
  if (script.identity.validatedAt === null)
    return { tone: 'todo', label: 'À valider', line: 'Son identité à valider.', opens: 'identity' };
  return { tone: 'ok', label: 'Prêt', line: 'L’IA peut le proposer.', opens: null };
}

/** The head's line: how many of her active scripts the agent can offer. */
export function revealSummary(scripts: readonly PlatformScriptViewDto[]): string {
  const active = scripts.filter((script) => script.active);
  if (active.length === 0) return 'Aucun script dans Reveal';
  const ready = active.filter((script) => script.proposable).length;
  const toDo = active.filter((script) => revealStanding(script).tone === 'todo').length;
  const head = `${String(ready)} prêt${ready > 1 ? 's' : ''} à proposer sur ${String(active.length)}`;
  return toDo === 0 ? head : `${head} · ${String(toDo)} à valider ou importer`;
}

export const ENERGY_LABELS: Readonly<Record<ScriptEnergy, string>> = {
  soft: 'Douce',
  rising: 'Qui monte',
  intense: 'Intense',
};

/** The same, as a value read among the others of its identity: in lower case, like them. */
export const ENERGY_VALUES: Readonly<Record<ScriptEnergy, string>> = {
  soft: 'douce',
  rising: 'qui monte',
  intense: 'intense',
};

/** Its steps' prices, offered steps said so, in the script's order: « Offert · 12 € · 25 € ». */
export function priceLine(script: PlatformScriptViewDto): string {
  const prices = script.steps.map((step) =>
    step.priceMinor === 0
      ? 'Offert'
      : `${(step.priceMinor / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`,
  );
  return `${plural(script.steps.length, 'étape', 'étapes')} · ${prices.join(' · ')}`;
}
