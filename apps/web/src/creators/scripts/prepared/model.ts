import type {
  BranchCondition,
  CopyDifference,
  Currency,
  PreparedScriptMoment,
  PreparedBranch,
  PreparedScriptContent,
  PreparedScriptGap,
  PreparedScriptView,
  PreparedScriptWarning,
  PreparedStep,
} from '@impera/contracts';

/**
 * Créatrices › Scripts › Scripts (ADR 0112 §§ 20-24, SCB-04 lot 3): what the editor of a script in preparation shows,
 * pure. The gaps and the warnings are the server's, read back after each save: the screen never decides one itself.
 */

/** A new key for a step or a branch: a client-made UUID, stable across saves (`PreparedKeySchema`). */
export const newKey = (): string => crypto.randomUUID();

export function emptyBranch(currency: Currency = 'EUR'): PreparedBranch {
  return {
    key: newKey(),
    condition: null,
    teaser: '',
    offerText: '',
    media: [],
    afterMedia: { justAfter: '', unread: '', readNotBought: '' },
    priceMinor: 0,
    currency,
  };
}

export const emptyStep = (): PreparedStep => ({ key: newKey(), rhythm: 0, branches: [emptyBranch()] });

/** « Créer le brouillon »: a first empty step, everything to fill. */
export const newContent = (
  name: string,
  description: string,
  moment: PreparedScriptMoment,
): PreparedScriptContent => ({
  name: name.trim(),
  description: description.trim(),
  moment,
  steps: [emptyStep()],
});

/** `12 €`, `12,50 €`, `Offert` for nothing: as a fan reads a price. */
export function priceLabel(minor: number): string {
  if (minor === 0) return 'Offert';
  const euros = minor / 100;
  return `${euros.toLocaleString('fr-FR', { minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })} €`;
}

/** What the price field reads (`12`, `12,5`, `12.50`) in minor units; `null` for what is not a price. */
export function parsePrice(text: string): number | null {
  const clean = text.trim().replace(/\s|€/gu, '').replace(',', '.');
  if (clean === '') return 0;
  if (!/^\d{1,5}(\.\d{0,2})?$/u.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** The price field's text for a price: empty for an offered step, so that it reads « Offert » as its placeholder. */
export const priceText = (minor: number): string =>
  minor === 0 ? '' : (minor / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/** Where a branch is, by its key: its step's index and its own. */
export function branchAt(
  content: PreparedScriptContent,
  key: string,
): { readonly step: number; readonly index: number; readonly branch: PreparedBranch } | null {
  for (const [step, one] of content.steps.entries()) {
    const index = one.branches.findIndex((branch) => branch.key === key);
    const branch = one.branches[index];
    if (branch !== undefined) return { step, index, branch };
  }
  return null;
}

/** « Étape 2, branche 3 »: a branch named by where it is, for a condition that follows it. */
export function branchPlace(content: PreparedScriptContent, key: string): string {
  const at = branchAt(content, key);
  if (at === null) return 'une branche retirée';
  const step = content.steps[at.step];
  return step !== undefined && step.branches.length > 1
    ? `étape ${String(at.step + 1)}, branche ${String(at.index + 1)}`
    : `étape ${String(at.step + 1)}`;
}

/** A condition said for a person: its kind on the tab, its text under it. */
export function conditionLabel(
  condition: BranchCondition | null,
  content: PreparedScriptContent,
): { readonly kind: string; readonly text: string } {
  if (condition === null) return { kind: 'À régler', text: 'Dis quand prendre cette branche' };
  if (condition.kind === 'none') return { kind: 'Par défaut', text: 'Quand aucune autre ne s’applique' };
  if (condition.kind === 'text') return { kind: 'Lu par l’IA', text: condition.text };
  const rule = condition.rule;
  if (rule.kind === 'spent_at_least')
    return { kind: 'Dépense', text: `A déjà dépensé ${priceLabel(rule.amountMinor)} ou plus chez elle` };
  const at = branchAt(content, rule.stepRef);
  return {
    kind: 'Étape d’avant',
    text:
      at === null
        ? 'Suit une branche retirée'
        : `A pris la branche ${String(at.index + 1)} à l’étape ${String(at.step + 1)}`,
  };
}

/** The branches of the earlier steps a « Branche prise avant » can follow: only steps that have several. */
export function previousBranches(
  content: PreparedScriptContent,
  stepIndex: number,
): readonly { readonly key: string; readonly label: string }[] {
  return content.steps.slice(0, stepIndex).flatMap((step, index) =>
    step.branches.length < 2
      ? []
      : step.branches.map((branch, order) => ({
          key: branch.key,
          label: `Étape ${String(index + 1)}, branche ${String(order + 1)} · ${conditionLabel(branch.condition, content).kind}`,
        })),
  );
}

/** « Offerte », « Payante », « 3 branches »: what a step is, on its head. */
export function stepKind(step: PreparedStep): string {
  if (step.branches.length > 1) return `${String(step.branches.length)} branches`;
  return (step.branches[0]?.priceMinor ?? 0) === 0 ? 'Offerte' : 'Payante';
}

const where = (
  content: PreparedScriptContent,
  gap: { step: number | null; branch: string | null },
): string => {
  if (gap.step === null) return 'Le script';
  const step = content.steps[gap.step];
  if (gap.branch === null || step === undefined || step.branches.length < 2)
    return `Étape ${String(gap.step + 1)}`;
  const index = step.branches.findIndex((branch) => branch.key === gap.branch);
  return `Étape ${String(gap.step + 1)}, branche ${String(index + 1)}`;
};

const GAP_TEXTS: Readonly<Record<PreparedScriptGap['code'], string>> = {
  name_missing: 'il lui faut un nom',
  description_missing: 'il lui faut une description',
  offer_text_missing: 'le texte d’offre est vide',
  media_missing: 'aucun média',
  media_absent: 'un média n’est plus dans son coffre',
  media_not_described: 'un média n’a pas de description validée',
  media_offered: 'un média a déjà été offert, il ne se revend pas',
  branch_unsettled: 'dis quand prendre cette branche',
  branch_two_defaults: 'deux branches par défaut, une seule permise',
  branch_cheaper_on_spend: 'une condition de dépense mène à une branche moins chère que celle par défaut',
  branch_previous_unknown: 'la branche suivie n’existe plus',
  price_not_above_previous:
    'prix pas plus haut que l’étape payante d’avant\u00a0: monte le prix de cette branche',
  media_twice: 'le même média est vendu deux fois',
  disgust: 'un texte touche une de ses limites',
  condition_text_missing: 'la phrase que l’IA vérifie est vide',
};

/** « Étape 2, branche 1 : aucun média », and for a limit, the entry of her persona touched, as she wrote it. */
export function gapText(content: PreparedScriptContent, gap: PreparedScriptGap): string {
  const text =
    gap.code === 'disgust' && gap.term !== null ? `un texte touche « ${gap.term} »` : GAP_TEXTS[gap.code];
  return `${where(content, gap)} : ${text}`;
}

const WARNING_TEXTS: Readonly<Record<PreparedScriptWarning['code'], string>> = {
  price_more_than_double: 'plus du double de l’étape payante d’avant',
  step_without_default: 'aucune branche par défaut : un fan sans condition remplie ne reçoit rien',
};

export const warningText = (content: PreparedScriptContent, warning: PreparedScriptWarning): string =>
  `${where(content, warning)} : ${WARNING_TEXTS[warning.code]}`;

/**
 * A media sold in a paid step of one of her scripts and offered in another (REV-08, ADR 0145 § 2): a fan who received
 * it offered can never buy the step that sells it. Read against her other scripts of the same account, both ways: a
 * warning, never a gap; one line per branch and other script.
 */
export function crossScriptWarnings(
  script: Pick<PreparedScriptView, 'id' | 'platformAccountId'>,
  content: PreparedScriptContent,
  others: readonly Pick<PreparedScriptView, 'id' | 'platformAccountId' | 'content'>[],
): string[] {
  const sold = new Map<string, Set<string>>();
  const offered = new Map<string, Set<string>>();
  for (const other of others) {
    if (other.id === script.id || other.platformAccountId !== script.platformAccountId) continue;
    for (const branch of other.content.steps.flatMap((step) => step.branches))
      for (const media of branch.media) {
        const into = branch.priceMinor > 0 ? sold : offered;
        const names = into.get(media.ref) ?? new Set<string>();
        names.add(other.content.name.trim() === '' ? 'un autre script' : `« ${other.content.name.trim()} »`);
        into.set(media.ref, names);
      }
  }
  const lines = new Set<string>();
  for (const branch of content.steps.flatMap((step) => step.branches)) {
    const place = branchPlace(content, branch.key).replace(/^./u, (first) => first.toUpperCase());
    const against = branch.priceMinor > 0 ? offered : sold;
    for (const media of branch.media)
      for (const name of against.get(media.ref) ?? [])
        lines.add(
          branch.priceMinor > 0
            ? `${place} : un de ses médias est offert dans ${name}, un fan qui l’a reçu ne pourra pas l’acheter ici`
            : `${place} : un de ses médias est vendu dans ${name}, l’offrir ici le rend invendable à ce fan`,
        );
  }
  return [...lines];
}

/** What keeps the copy from being recognised, for « À copier dans Reveal ». */
export function differenceText(content: PreparedScriptContent, difference: CopyDifference): string {
  switch (difference.code) {
    case 'name_not_found':
      return 'Aucun script de ce nom dans Reveal pour l’instant';
    case 'steps_count':
      return `Reveal a ${String(difference.found)} étape${difference.found > 1 ? 's' : ''}, il en faut ${String(difference.expected)}`;
    case 'branches_count':
      return `Étape ${String(difference.step + 1)} : Reveal a ${String(difference.found)} branche${difference.found > 1 ? 's' : ''}, il en faut ${String(difference.expected)}`;
    case 'branch_not_found':
      return `${where(content, { step: difference.step, branch: difference.branch })} : aucune branche de Reveal ne vend ces médias à ce prix`;
  }
}

/** A path through the script: one branch at each step, what a fan pays step by step and in all. */
export interface ScriptPath {
  readonly name: string;
  readonly prices: readonly number[];
  readonly totalMinor: number;
}

/** Paths shown at most: past that, the rail says how many more there are. */
export const PATHS_SHOWN = 8;

/**
 * A path named whole, after every branch taken that is not a default one: « Par défaut », or « A déjà dépensé 50 € ou
 * plus chez elle, puis s’il a parlé de la robe ». A condition said in words keeps its words; a branch kept for those
 * who took another one, whose condition is already in the name, is named by what it says (its teaser, else its offer),
 * by its place only when it says nothing yet.
 */
function pathName(content: PreparedScriptContent, taken: readonly PreparedBranch[]): string {
  const parts = taken.flatMap((branch, step) => {
    const condition = branch.condition;
    const index = content.steps[step]?.branches.indexOf(branch) ?? 0;
    // A branch among others whose condition is still to set is no default: named by its place, never « Par défaut »
    // (PRO1-07). A step's lone branch needs none.
    if (condition === null)
      return (content.steps[step]?.branches.length ?? 0) > 1
        ? [`branche ${String(index + 1)} à l’étape ${String(step + 1)}, à régler`]
        : [];
    if (condition.kind === 'none') return [];
    if (condition.kind === 'text' || condition.rule.kind === 'spent_at_least')
      return [conditionLabel(condition, content).text];
    const said = (branch.teaser.trim() === '' ? branch.offerText : branch.teaser).trim();
    if (said !== '') return [`« ${said} »`];
    return [`branche ${String(index + 1)} à l’étape ${String(step + 1)}`];
  });
  if (parts.length === 0) return 'Par défaut';
  const said = parts.map((part, at) =>
    at === 0
      ? part.replace(/^./u, (first) => first.toUpperCase())
      : part.replace(/^./u, (first) => first.toLowerCase()),
  );
  return said.join(', puis ');
}

const followed = (branch: PreparedBranch): string | null =>
  branch.condition?.kind === 'structured' && branch.condition.rule.kind === 'previous_branch'
    ? branch.condition.rule.stepRef
    : null;

/**
 * Whether a fan who took `taken` can take this branch: a branch kept for those who took another one needs it; and when
 * such a branch of the step holds for him, its rule passes before what the AI reads and before the default, so neither
 * of those is taken.
 */
function reachable(
  branch: PreparedBranch,
  siblings: readonly PreparedBranch[],
  taken: (key: string) => boolean,
): boolean {
  const after = followed(branch);
  if (after !== null) return taken(after);
  const kind = branch.condition?.kind;
  if (kind === 'structured') return true;
  return !siblings.some((one) => {
    const key = followed(one);
    return key !== null && taken(key);
  });
}

/**
 * The paths a fan can take: one branch at each step, as `reachable` allows.
 * Counted step by step on the branches some later branch follows (four branches on ten steps would be a million to
 * walk), and only the first `PATHS_SHOWN` built, the default branches first, each named whole (`pathName`).
 */
export function scriptPaths(content: PreparedScriptContent): {
  readonly shown: readonly ScriptPath[];
  readonly count: number;
} {
  const watched = new Set(
    content.steps.flatMap((step) => step.branches.map(followed)).filter((key) => key !== null),
  );
  let ways = new Map<string, number>([['', 1]]);
  for (const step of content.steps) {
    const next = new Map<string, number>();
    for (const [state, n] of ways) {
      const taken = new Set(state === '' ? [] : state.split(' '));
      for (const branch of step.branches) {
        if (!reachable(branch, step.branches, (key) => taken.has(key))) continue;
        const key = watched.has(branch.key) ? [...taken, branch.key].sort().join(' ') : state;
        next.set(key, (next.get(key) ?? 0) + n);
      }
    }
    ways = next;
  }
  const count = [...ways.values()].reduce((sum, n) => sum + n, 0);
  const shown: ScriptPath[] = [];
  const walk = (step: number, taken: readonly PreparedBranch[]): void => {
    if (shown.length >= PATHS_SHOWN) return;
    const one = content.steps[step];
    if (one === undefined) {
      shown.push({
        name: pathName(content, taken),
        prices: taken.map((branch) => branch.priceMinor),
        totalMinor: taken.reduce((sum, branch) => sum + branch.priceMinor, 0),
      });
      return;
    }
    const ordered = [...one.branches].sort(
      (a, b) => Number(b.condition?.kind === 'none') - Number(a.condition?.kind === 'none'),
    );
    for (const branch of ordered) {
      if (!reachable(branch, one.branches, (key) => taken.some((was) => was.key === key))) continue;
      walk(step + 1, [...taken, branch]);
    }
  };
  walk(0, []);
  return { shown, count };
}

/** « 2 manques », « Prêt à copier », « Dans Reveal »: a script's state on its row. */
export function stateLabel(view: PreparedScriptView): {
  readonly text: string;
  readonly tone: 'warn' | 'copy' | 'on' | 'plain';
} {
  if (view.state === 'matched') return { text: 'Dans Reveal', tone: 'on' };
  if (view.state === 'ready_to_copy') return { text: 'À copier dans Reveal', tone: 'copy' };
  if (view.gaps.length === 0) return { text: 'Rien ne manque', tone: 'plain' };
  return { text: view.gaps.length === 1 ? '1 manque' : `${String(view.gaps.length)} manques`, tone: 'warn' };
}

export const momentLabel = (moment: PreparedScriptMoment): string =>
  moment === 'day' ? 'Jour' : moment === 'night' ? 'Nuit' : 'Jour et nuit';

/** What changes in a script, one gesture at a time: each returns a new content, the old one untouched. */
export function withStep(
  content: PreparedScriptContent,
  index: number,
  change: (step: PreparedStep) => PreparedStep,
): PreparedScriptContent {
  return { ...content, steps: content.steps.map((step, at) => (at === index ? change(step) : step)) };
}

export function withBranch(
  content: PreparedScriptContent,
  key: string,
  change: (branch: PreparedBranch) => PreparedBranch,
): PreparedScriptContent {
  return {
    ...content,
    steps: content.steps.map((step) => ({
      ...step,
      branches: step.branches.map((branch) => (branch.key === key ? change(branch) : branch)),
    })),
  };
}

/**
 * A step loses a branch: a condition that followed it is unset, never pointed elsewhere; the only branch left needs no
 * condition.
 */
export function withoutBranch(content: PreparedScriptContent, key: string): PreparedScriptContent {
  const steps = content.steps.map((step) => {
    if (!step.branches.some((branch) => branch.key === key) || step.branches.length < 2) return step;
    const branches = step.branches.filter((branch) => branch.key !== key);
    return {
      ...step,
      branches: branches.length === 1 ? branches.map((branch) => ({ ...branch, condition: null })) : branches,
    };
  });
  return {
    ...content,
    steps: steps.map((step) => ({ ...step, branches: step.branches.map((branch) => unfollow(branch, key)) })),
  };
}

const unfollow = (branch: PreparedBranch, key: string): PreparedBranch =>
  branch.condition?.kind === 'structured' &&
  branch.condition.rule.kind === 'previous_branch' &&
  branch.condition.rule.stepRef === key
    ? { ...branch, condition: null }
    : branch;

/** A step removed: the conditions that followed one of its branches are unset. */
export function withoutStep(content: PreparedScriptContent, index: number): PreparedScriptContent {
  const gone = new Set(content.steps[index]?.branches.map((branch) => branch.key) ?? []);
  if (content.steps.length < 2) return content;
  return {
    ...content,
    steps: content.steps
      .filter((_, at) => at !== index)
      .map((step) => ({
        ...step,
        branches: step.branches.map((branch) => [...gone].reduce((kept, key) => unfollow(kept, key), branch)),
      })),
  };
}

/** A step moved by one place, up or down; a move past an end leaves the script as it was. */
export function withStepMoved(
  content: PreparedScriptContent,
  index: number,
  by: -1 | 1,
): PreparedScriptContent {
  const to = index + by;
  const moving = content.steps[index];
  const other = content.steps[to];
  if (moving === undefined || other === undefined) return content;
  const steps = [...content.steps];
  steps[to] = moving;
  steps[index] = other;
  return { ...content, steps };
}

/** A branch added to a step: the first one becomes the default if it had no condition yet. */
export function withBranchAdded(content: PreparedScriptContent, index: number): PreparedScriptContent {
  return withStep(content, index, (step) => ({
    ...step,
    branches: [
      ...step.branches.map((branch) =>
        step.branches.length === 1 && branch.condition === null
          ? { ...branch, condition: { kind: 'none' as const } }
          : branch,
      ),
      emptyBranch(step.branches[0]?.currency ?? 'EUR'),
    ],
  }));
}
