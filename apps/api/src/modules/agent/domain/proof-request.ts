import { normalise } from '@impera/contracts';

/**
 * A proof he asks of her that she is real (guide 26/11), read by code beside the brain's `occasion` (passe 3 du 27/11,
 * conversation 31): after two messages of doubt, the brain read « prouve-le : un selfie avec deux doigts sur la joue »
 * as a doubt only, and the custom order never fired. Code reads two shapes, in French, English, Spanish and Italian:
 * a proof word with a media asked, or a media he asks of her with a precise gesture or his name in it.
 */

// A photo, a selfie, a voice note, a video: what a proof is made of.
const MEDIA =
  '(selfies?|photos?|pics?|picture|vocal|vocaux|audio|voice ?note|videos?|foto|fotos|vocale|nota de voz)';

// A word that asks a proof: « prouve-le », « une preuve », « prove it », « demuéstralo », « dimostralo ».
const PROOF_WORD =
  /\b(prouve[- ]?(le|moi|la)?|prouver|une preuve|des preuves|la preuve|prove (it|that|you|me)|proof|demuestr\w*|pruebalo|dimostr\w*|una prova)\b/;

// What makes a media a proof: a precise gesture, something written, his name said or written.
const GESTURE =
  '(doigts?|pouce|main|signe|geste|papier|feuille|ecrit|mon (pre)?nom|mon blaze|fingers?|thumbs?|hand|sign|paper|written|my name|dedos?|mano|papel|mi nombre|dita|pollice|foglio|il mio nome)';
const MEDIA_WITH_GESTURE = new RegExp(`\\b${MEDIA}\\b.{0,60}\\b${GESTURE}\\b`);
const MEDIA_ASKED = new RegExp(`\\b${MEDIA}\\b`);
// He asks it of her, not tells of his own: « envoie », « montre », « maintenant », « où tu dis », « can you », « fammi ».
const ASKED_OF_HER =
  /\b(envoie|envoi|montre|fais|fait|prends|je veux|j'?en veux|tu peux|tu me|maintenant|tout de suite|ou tu (dis|ecris|fais)|send|show|take|i want|can you|now|where you (say|write)|manda|ensena|haz|ahora|voglio|fammi|mandami|puoi|adesso|subito)\b/;

/** His message asks her a proof she is real: a proof word with a media, or a media with a precise gesture or his name. */
export function asksProof(fanText: string): boolean {
  const text = normalise(fanText);
  return (
    MEDIA_ASKED.test(text) &&
    (PROOF_WORD.test(text) || (MEDIA_WITH_GESTURE.test(text) && ASKED_OF_HER.test(text)))
  );
}

type Occasion = 'says_love' | 'asks_proof' | 'partner_returns' | 'unsolicited_explicit';

/**
 * The brain's reading with the proof code reads in his message: `asks_proof` when it named no other occasion, and no
 * `manipulation_attempt` read on it, since a proof he asks is relayed by rule (guide 26/11), never a trap. Patterns of
 * injection in his words are still read by `assessTrap` on the text itself.
 */
export function withProofRead<
  B extends { readonly occasion?: Occasion | undefined; readonly risks: readonly string[] },
>(brief: B, fanText: string): B {
  if (!asksProof(fanText)) return brief;
  if (brief.occasion !== undefined && brief.occasion !== 'asks_proof') return brief;
  return {
    ...brief,
    occasion: 'asks_proof',
    risks: brief.risks.filter((risk) => risk !== 'manipulation_attempt'),
  };
}
