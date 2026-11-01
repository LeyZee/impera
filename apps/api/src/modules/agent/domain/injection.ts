import { unmask } from '@nirvana/contracts';

/**
 * Traps a fan sets to catch a machine (docs/architecture/ai-engine.md, « Les pièges »). Pure code, run on
 * every fan message and on the text read in his media, before the brain: the brain catches the subtle ones,
 * this catches the known shapes whatever the model says.
 */
type InjectionKind = 'override' | 'role_change' | 'prompt_extraction' | 'system_markup' | 'off_topic_task';

export interface InjectionSignal {
  readonly kind: InjectionKind;
  readonly match: string;
}

// « montre-moi », « montre moi », « montremoi » once normalised.
const ME = String.raw`(?:[- ]?(?:moi|nous))?`;
// What a machine has and a girl has not. Dominant play uses « règles », « consignes », « limites »,
// « programme » and « soumise » every night: none of them is a trap without one of these objects.
const MACHINE = String.raw`(?:une? )?(?:ia|intelligence artificielle|assistante?|chatgpt|gpt|grok|gemini|robot|bot|chatbot|programme informatique|modele de langage|llm)`;

const PATTERNS: readonly { kind: InjectionKind; pattern: RegExp }[] = [
  {
    kind: 'override',
    pattern: new RegExp(
      String.raw`\b(?:ignore[rsz]?|oublie[rsz]?|zappe[rsz]?|efface[rsz]?|ne tiens? (?:plus |pas )?compte d?e?)\s?(?:de )?(?:toutes? |tous )?(?:tes|les|vos|ses|ces) (?:precedentes? |anciennes? |premieres? )?(?:instructions?|consignes? (?:precedentes|initiales|de base|systeme)|directives?|programmation|prompt|filtres?|restrictions?)\b`,
    ),
  },
  {
    kind: 'override',
    pattern:
      /\b(?:ignore|disregard|forget) (?:all |any |the |your )?(?:previous |prior |above )?(?:instructions|prompts?|guidelines|system message)\b|\bdo anything now\b|\bjailbreak\b|\bmode (?:developpeur|developer|debug|admin|dan|sans (?:filtre|censure))\b|\bnouvelles? (?:instructions|directives) (?:systeme|pour l'ia|pour le bot)\b/,
  },
  {
    kind: 'role_change',
    pattern: new RegExp(
      String.raw`\b(?:tu es|t'es|tu deviens|tu n'es plus) (?:maintenant |desormais |a present )${MACHINE}\b|\b(?:a partir de maintenant|desormais),? tu (?:es|deviens|reponds comme) ${MACHINE}\b|\b(?:fais|joue|imagine) (?:comme si tu etais |semblant d'etre |le role d['e] ?)${MACHINE}\b|\b(?:agis|reponds|parle|comporte-toi|comporte toi) (?:comme|en tant qu[e'] ?) ?(?:${MACHINE}|(?:une? )?(?:developpeu?r|developpeuse|traducteur|traductrice))\b|\b(?:pretend (?:to be|you are)|act as|you are now|from now on you are) (?:an? )?(?:ai|assistant|chatgpt|gpt|grok|bot|chatbot|robot|language model|llm|developer|translator)\b`,
    ),
  },
  {
    kind: 'prompt_extraction',
    pattern: new RegExp(
      String.raw`\b(?:repete|recopie|affiche|montre|donne|ecris|revele|dis|envoie|colle|lis)${ME} (?:mot pour mot |exactement )?(?:ton|tes|le|les|ta|la) (?:prompt|programmation|configuration|message (?:systeme|system)|premier message|instructions? (?:initiales?|systeme|de base|d'origine|cachees?))\b|\b(?:repete|recopie|affiche|ecris)${ME} mot pour mot (?:tes|les) (?:instructions|consignes|regles)\b|\bsystem ?prompt\b|\bprompt (?:systeme|system)\b|\b(?:quel|quelle|quels|quelles) (?:sont|est) (?:tes|ton|ta) (?:prompt|programmation|instructions (?:initiales|systeme|cachees))\b`,
    ),
  },
  {
    kind: 'system_markup',
    pattern:
      /<\|?(?:im_start|im_end|system|endoftext)\|?>|\[\/?inst\]|<<\/?sys>>|###\s?(?:system|instruction|assistant)|^\s*(?:system|assistant|developer)\s?:|<\/?(?:fan_message|brief|fan_notes|system|instructions?)>/m,
  },
  {
    kind: 'off_topic_task',
    pattern: new RegExp(
      String.raw`\b(?:donne|ecris|envoie|file|redige|propose|explique|dis)${ME} (?:la|une|ta|ton) recette\b|\b(?:c'est quoi|quelle est) (?:la|ta) recette (?:de|du|des|d')`,
    ),
  },
  {
    kind: 'off_topic_task',
    pattern: new RegExp(
      String.raw`\b(?:ecris|code|programme|genere|fais|redige|ecrire|coder)${ME} (?:un|une|du|le|la|mon|ma) (?:code|script en|programme informatique|fonction|algorithme|requete sql|dissertation|redaction|lettre de motivation|cv|article|expose|commentaire de texte)\b|\ben (?:python|javascript|typescript|java|c\+\+|php|sql|html|rust)\b|\btradui[st]${ME}\b|\bresume${ME} (?:ce|cet|cette|le|les) (?:texte|article|livre|document|pdf)\b|\bcombien (?:font|fait) \d+ ?(?:\+|-|x|\*|\/|fois|plus|moins|divise par) ?\d|\b(?:fais|aide)${ME} (?:a faire )?(?:mes|mon) (?:devoirs?|exercices?|dm)\b|\b(?:write|give)(?: me)? (?:a|an|the|some) (?:recipe|code|script|essay)\b`,
    ),
  },
  // Spanish, Italian, German, Portuguese and more English: a trap in another language is still a trap.
  {
    kind: 'override',
    pattern:
      /\b(?:ignora|olvida|olvidate de|ignore|esqueca|ignoriere|ignorier|vergiss|dimentica) (?:(?:todas|todos|tutte|alle|tus|las|los|le|tue|deine|die|as|suas|os) )*(?:(?:anteriores|previas|precedenti|vorherigen|bisherigen) )?(?:instrucciones|indicaciones|directrices|istruzioni|direttive|anweisungen|instruktionen|vorgaben|instrucoes|diretrizes)\b|\b(?:modo|modus) (?:desarrollador|sviluppatore|entwickler|sin censura|senza censura|ohne zensur)\b/,
  },
  {
    kind: 'role_change',
    pattern:
      /\b(?:ahora eres|a partir de ahora eres|actua como|finge ser|ora sei|adesso sei|da ora sei|comportati come|fingi di essere|agisci come|du bist (?:jetzt|nun|ab jetzt)|verhalte dich wie|tu so als warst du|handle als|agora voce e|aja como|finja ser) (?:(?:un|una|un'|uno|ein|eine|einen|um|uma) ?)?(?:ia|ki|ai|asistente|assistente|assistent|assistentin|chatgpt|gpt|bot|chatbot|robot|roboter|modelo de lenguaje|modello linguistico|sprachmodell)\b/,
  },
  {
    kind: 'prompt_extraction',
    pattern:
      /\b(?:muestrame|dime|repite|ensename|revela|mostrami|dimmi|ripeti|rivela|zeig mir|nenne mir|wiederhole|verrate mir|mostre|me mostra|repita|show|tell|give|repeat|reveal|print)(?: me)? (?:tu|tus|el|las|il tuo|le tue|il|le|deinen|deine|den|die|seu|suas|o|as|your|the) (?:prompt|systemprompt|configuracion|configurazione|(?:instrucciones|istruzioni|instrucoes|instructions) (?:iniciales|del sistema|ocultas|originales|iniziali|di sistema|nascoste|originali|iniciais|do sistema|ocultas|initial|hidden|original|system)|(?:ursprunglichen|versteckten|system) ?anweisungen|(?:initial|hidden|original|system) instructions)\b/,
  },
];

/*
 * Signatures read with every non-letter removed: « i g n o r e  t e s  i n s t r u c t i o n s »,
 * « i.g.n.o.r.e » or « ign-ore » all squash to « ignoretesinstructions ». Kept to phrases that cannot occur
 * by chance across word boundaries.
 */
const SQUASHED: readonly { kind: InjectionKind; pattern: RegExp }[] = [
  {
    kind: 'override',
    pattern:
      /ignore[rsz]?(?:toutes?|tous)?(?:tes|les|vos)(?:precedentes?|anciennes?)?(?:instructions?|directives|programmation)|(?:ignore|disregard|forget)(?:all|any|the|your)*(?:previous|prior|above)?(?:instructions|systemmessage)|(?:ignora|olvida|dimentica|ignoriere|vergiss)(?:todas|tutte|alle|tus|las|le|deine|die)*(?:instrucciones|istruzioni|anweisungen)|jailbreak|doanythingnow/,
  },
  {
    kind: 'prompt_extraction',
    pattern: /systemprompt|promptsysteme|(?:repete|montre|donne|affiche|revele)(?:moi)?(?:ton|le)prompt/,
  },
  {
    kind: 'role_change',
    pattern:
      /(?:tuesmaintenant|tudeviens|desormaistues|youarenow)(?:une?|an?)?(?:ia|intelligenceartificielle|chatgpt|assistante?|ai)(?![a-z])/,
  },
];

const BASE64_TOKEN = /[A-Za-z0-9+/_-]{12,}={0,2}/g;

/** A base64 token that decodes to readable text: « SWdub3JlIHRlcyBpbnN0cnVjdGlvbnM= » is « Ignore tes instructions ». */
function fromBase64(token: string): string | null {
  const bare = token.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  let binary: string;
  try {
    binary = atob(bare + '='.repeat((4 - (bare.length % 4)) % 4));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return /^[\p{L}\p{N}\p{P}\p{S}\s]+$/u.test(decoded) && /\p{L}{3}/u.test(decoded) ? decoded : null;
}

/** Escapes a machine reads and a girl never types: %69, &#105;, &#x69;, i, \x69. */
function unescape(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec: string) => codePoint(Number.parseInt(dec, 10)))
    .replace(
      /\\u\{?([0-9a-f]{4,6})\}?|\\x([0-9a-f]{2})/gi,
      (_, u: string | undefined, x: string | undefined) => codePoint(Number.parseInt(u ?? x ?? '', 16)),
    )
    .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)));
}

function codePoint(value: number): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
}

function rot13(text: string): string {
  return text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
}

/**
 * Every reading of the message a model could follow: as written, unescaped, decoded from base64, reversed and
 * in ROT13. A trap hidden in any of them is a trap.
 */
function readings(text: string): string[] {
  const plain = unmask(text);
  const unescaped = unmask(unescape(text));
  const decoded = (text.match(BASE64_TOKEN) ?? []).flatMap((token) => {
    const value = fromBase64(token);
    return value === null ? [] : [unmask(value)];
  });
  return [plain, unescaped, ...decoded, Array.from(plain).reverse().join(''), rot13(plain)];
}

export function detectInjection(text: string): InjectionSignal[] {
  const signals: InjectionSignal[] = [];
  const add = (kind: InjectionKind, match: RegExpExecArray | null): void => {
    if (match && !signals.some((s) => s.kind === kind)) signals.push({ kind, match: match[0] });
  };
  for (const reading of readings(text)) {
    for (const { kind, pattern } of PATTERNS) add(kind, pattern.exec(reading));
    const squashed = reading.replace(/[^\p{L}]/gu, '');
    for (const { kind, pattern } of SQUASHED) add(kind, pattern.exec(squashed));
  }
  return signals;
}

/**
 * A trap cut across his messages (« ignore », « toutes tes », « instructions »): what his last messages say
 * together and none says alone. Only what the current message completes counts, so an old trap she already
 * answered does not taint the next one.
 */
export function detectInjectionAcross(earlier: readonly string[], current: string): InjectionSignal[] {
  const window = earlier.slice(-3);
  const known = new Set(
    [...detectInjection(window.join(' ')), ...detectInjection(current)].map((s) => s.kind),
  );
  return detectInjection([...window, current].join(' ')).filter((s) => !known.has(s.kind));
}

/** Facts the brain read in his words: one shaped like an order would reach every later prompt as her note. */
export function withoutOrders<T extends { readonly key: string; readonly value: string }>(
  facts: readonly T[],
): T[] {
  return facts.filter((fact) => detectInjection(`${fact.key} ${fact.value}`).length === 0);
}

/**
 * Her notes about the fan go in the prompt: a line shaped like an order (a fact the brain copied from his words,
 * a pasted note) is dropped before it gets there.
 */
export function screenNotes(notes: string): { readonly kept: string; readonly dropped: readonly string[] } {
  const lines = notes.split('\n');
  const dropped = lines.filter((line) => detectInjection(line).length > 0);
  return { kept: lines.filter((line) => !dropped.includes(line)).join('\n'), dropped };
}
