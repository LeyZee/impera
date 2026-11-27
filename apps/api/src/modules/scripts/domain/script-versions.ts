import type {
  BranchCondition,
  PreparedBranch,
  PreparedScriptContent,
  PreparedScriptGap,
  PreparedStep,
} from '@impera/contracts';

/**
 * A script in another language (langue du fan, lot 2; methode-chatting § 10.19): a version of a script of ours, linked
 * to it, which sells the same media at the same prices in the same steps and branches, only its texts translated by the
 * agency. Pure.
 */

/** Its texts: what a version translates, and alone may change. */
type BranchTexts = Pick<PreparedBranch, 'teaser' | 'offerText' | 'afterMedia'>;

/** A price or a currency said in a text: a version never says one, Reveal shows its own (in her currency). */
const PRICE_SAID = /(\d[\d\s.,]*\s?(€|\$|£|eur\b|euros?\b|usd\b|dollars?\b|gbp\b))|((€|\$|£)\s?\d)/iu;

/** The same condition but for the words of a text one, which a version translates. */
function sameCondition(a: BranchCondition | null, b: BranchCondition | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'text' || b.kind === 'text') return a.kind === b.kind;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What a version must keep from its source: everything but its texts. */
function sameSale(source: PreparedBranch, version: PreparedBranch): boolean {
  return (
    source.priceMinor === version.priceMinor &&
    source.currency === version.currency &&
    source.media.length === version.media.length &&
    source.media.every((media, at) => media.ref === version.media[at]?.ref) &&
    sameCondition(source.condition, version.condition)
  );
}

function sameStep(source: PreparedStep, version: PreparedStep): boolean {
  if (source.key !== version.key || source.rhythm !== version.rhythm) return false;
  if (source.branches.length !== version.branches.length) return false;
  return source.branches.every((branch, at) => {
    const other = version.branches[at];
    return other?.key === branch.key && sameSale(branch, other);
  });
}

const gap = (
  code: PreparedScriptGap['code'],
  step: number | null = null,
  branch: string | null = null,
): PreparedScriptGap => ({ code, step, branch, term: null });

/**
 * What keeps a version from « prêt à copier », besides the gaps of any script: a name of its own (an import recognises a
 * copy by its name, two of the same name are never matched), steps, branches, media, prices and rhythm the same as its
 * source's (`version_differs`, the script itself: « Reprendre la structure » sets it right), and no price said in a text.
 */
export function versionGaps(
  source: PreparedScriptContent,
  version: PreparedScriptContent,
): PreparedScriptGap[] {
  const gaps: PreparedScriptGap[] = [];
  if (version.name.trim() !== '' && version.name.trim() === source.name.trim())
    gaps.push(gap('version_name_same'));
  const differs =
    source.moment !== version.moment ||
    source.steps.length !== version.steps.length ||
    source.steps.some((step, at) => {
      const other = version.steps[at];
      return other === undefined || !sameStep(step, other);
    });
  if (differs) gaps.push(gap('version_differs'));
  version.steps.forEach((step, at) => {
    for (const branch of step.branches) {
      const said = [
        branch.teaser,
        branch.offerText,
        branch.afterMedia.justAfter,
        branch.afterMedia.unread,
        branch.afterMedia.readNotBought,
      ].join('\n');
      if (PRICE_SAID.test(said)) gaps.push(gap('version_mentions_price', at, branch.key));
    }
  });
  return gaps;
}

const EMPTY_TEXTS: BranchTexts = {
  teaser: '',
  offerText: '',
  afterMedia: { justAfter: '', unread: '', readNotBought: '' },
};

/**
 * The content of a version made from its source, or set right on it (« Reprendre la structure »): the source's steps,
 * branches, media, prices, conditions and moment, with the texts the version already has for a branch of the same key,
 * and empty ones for a branch it never had (to translate). A text condition keeps the version's words when it had them.
 * The name and the description stay the version's; a new version starts without them.
 */
export function versionContentOf(
  source: PreparedScriptContent,
  version: PreparedScriptContent | null,
): PreparedScriptContent {
  const known = new Map<string, PreparedBranch>();
  for (const step of version?.steps ?? []) for (const branch of step.branches) known.set(branch.key, branch);
  return {
    name: version?.name ?? '',
    description: version?.description ?? '',
    moment: source.moment,
    steps: source.steps.map((step) => ({
      ...step,
      branches: step.branches.map((branch) => {
        const had = known.get(branch.key);
        const texts: BranchTexts =
          had === undefined
            ? EMPTY_TEXTS
            : { teaser: had.teaser, offerText: had.offerText, afterMedia: had.afterMedia };
        const condition =
          branch.condition?.kind === 'text' && had?.condition?.kind === 'text'
            ? had.condition
            : branch.condition;
        return { ...branch, ...texts, condition };
      }),
    })),
  };
}
