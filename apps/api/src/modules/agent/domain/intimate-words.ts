// The English words for the same parts, plain and familiar (Sécurité, #1054: ordinary guard words).
const INTIMATE_PARTS_EN = 'penis|dick|cock|willy|vagina|pussy|breasts?|boobs?|tits|butt|ass|bum|booty';

/**
 * The intimate parts of the body, in the words the guards already read (the care mode's sexual lexicon, ADR 0088 § 3),
 * in French and English. One list, shared, so that no guard keeps its own copy of these words in the repository. On
 * the normalised text.
 */
export const INTIMATE_PARTS = `(?:sexe|zizi|bite|queue|chatte|seins?|nichons?|cul|fesses|${INTIMATE_PARTS_EN})`;
