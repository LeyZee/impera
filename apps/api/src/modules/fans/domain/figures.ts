import {
  FAN_FIGURES_MIN_CASE,
  FAN_FIGURES_MIN_FANS,
  FAN_FIGURES_TOP,
  normaliseWords,
  OTHER_CASE,
  type AgeBand,
  type CreatorFanInsights,
  type FanPlace,
  type FanSituation,
  type JobFamily,
} from '@impera/contracts';

/**
 * How a fact a fan declared becomes a case of « Qui sont tes fans » (ADR 0074 § 3 to § 6), and how counts become the
 * shares she reads (§ 8). Pure: the tables are code, they grow by PR, and no model ranks a value (a case guessed by a
 * model would be an inference, and a business rule does not live in a prompt). Every example in the tests is invented.
 */

/** The fact keys the figures read (ADR 0074 § 1), as `normalizeKey` writes them. */
export const FIGURE_KEYS = ['age', 'location', 'job', 'situation'] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

/**
 * A pattern is words in a row; a last word ending in `*` matches any word it begins (« infirmi* » reads « infirmier »
 * and « infirmière »). Values are compared after `normaliseWords`: no case, no accent, no punctuation.
 */
function matcher(pattern: string): (words: readonly string[]) => boolean {
  const parts = pattern.split(' ');
  return (words) => {
    for (let start = 0; start + parts.length <= words.length; start += 1) {
      const fits = parts.every((part, i) => {
        const word = words[start + i];
        if (word === undefined) return false;
        return part.endsWith('*') ? word.startsWith(part.slice(0, -1)) : word === part;
      });
      if (fits) return true;
    }
    return false;
  };
}

type Table<K extends string> = readonly (readonly [K, readonly string[]])[];

/** The first entry, in the table's order, one of whose patterns the value holds. */
function firstOf<K extends string>(table: Table<K>, words: readonly string[]): K | null {
  for (const [key, patterns] of table) if (patterns.some((p) => matcher(p)(words))) return key;
  return null;
}

/**
 * The entry whose matching pattern is the longest (« Pays de la Loire » before « Loire », « Bouches-du-Rhône » before
 * « Rhône »); on a tie, the first in the table's order.
 */
function longestOf<K extends string>(table: Table<K>, words: readonly string[]): K | null {
  let best: { key: K; length: number } | null = null;
  for (const [key, patterns] of table)
    for (const pattern of patterns) {
      const length = pattern.split(' ').length;
      if ((best === null || length > best.length) && matcher(pattern)(words)) best = { key, length };
    }
  return best?.key ?? null;
}

const wordsOf = (value: string) => normaliseWords(value).split(' ').filter(Boolean);

// --- Age (ADR 0074 § 3) -----------------------------------------------------------------------------------------

const UNITS: Readonly<Record<string, number>> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
};
const TENS: Readonly<Record<string, number>> = {
  dix: 10,
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
};

/** « dix-huit », « vingt et un », « soixante-douze », « quatre-vingt-dix-neuf »: the number the words begin with. */
function wordNumber(words: readonly string[]): number | null {
  let i = 0;
  let total: number;
  const at = (k: number) => words[k];
  if (at(i) === 'quatre' && (at(i + 1) === 'vingt' || at(i + 1) === 'vingts')) {
    total = 80;
    i += 2;
  } else {
    const tens = TENS[at(i) ?? ''];
    if (tens === undefined) return null;
    total = tens;
    i += 1;
  }
  if (at(i) === 'et') i += 1;
  const unit = UNITS[at(i) ?? ''];
  if (unit === undefined) return total;
  if (total === 10 && unit > 9) return total;
  total += unit;
  const after = UNITS[at(i + 1) ?? ''];
  // « soixante-dix-sept », « quatre-vingt-dix-neuf »
  if (unit === 10 && after !== undefined && after <= 9) total += after;
  return total;
}

/** The first whole number of the value, in digits or in words; `null` for a range or an approximation. */
export function ageOf(value: string): number | null {
  const words = wordsOf(value);
  if (words.some((w) => w.endsWith('aine')) || words.includes('entre') || words.includes('environ'))
    return null;
  const numbers = words.filter((w) => /^\d+$/.test(w));
  if (numbers.length > 1 && words.some((w) => w === 'et' || w === 'a' || w === 'ou')) return null;
  let age: number | null = null;
  const firstDigits = numbers[0];
  if (firstDigits !== undefined) age = Number(firstDigits);
  else {
    for (let i = 0; i < words.length && age === null; i += 1) age = wordNumber(words.slice(i));
  }
  return age !== null && age >= 18 && age <= 99 ? age : null;
}

export function ageBandOf(age: number): AgeBand {
  if (age < 25) return '18_24';
  if (age < 35) return '25_34';
  if (age < 45) return '35_44';
  if (age < 55) return '45_54';
  return '55_plus';
}

// --- Place (ADR 0074 § 4) ---------------------------------------------------------------------------------------

/** Each département's number, by region; overseas (971–976) as one. */
const DEPARTMENTS: Readonly<Record<string, FanPlace>> = Object.fromEntries(
  (
    [
      ['auvergne_rhone_alpes', '01 03 07 15 26 38 42 43 63 69 73 74'],
      ['bourgogne_franche_comte', '21 25 39 58 70 71 89 90'],
      ['bretagne', '22 29 35 56'],
      ['centre_val_de_loire', '18 28 36 37 41 45'],
      ['corse', '20 2a 2b'],
      ['grand_est', '08 10 51 52 54 55 57 67 68 88'],
      ['hauts_de_france', '02 59 60 62 80'],
      ['ile_de_france', '75 77 78 91 92 93 94 95'],
      ['normandie', '14 27 50 61 76'],
      ['nouvelle_aquitaine', '16 17 19 23 24 33 40 47 64 79 86 87'],
      ['occitanie', '09 11 12 30 31 32 34 46 48 65 66 81 82'],
      ['pays_de_la_loire', '44 49 53 72 85'],
      ['provence_alpes_cote_d_azur', '04 05 06 13 83 84'],
      ['outre_mer', '971 972 973 974 975 976'],
    ] as const
  ).flatMap(([region, numbers]) => numbers.split(' ').map((n) => [n, region] as const)),
);

/**
 * Regions, départements, cities and what people call themselves, then countries. The longest pattern found wins; on a
 * tie, the first in this order.
 */
const PLACES: Table<FanPlace> = [
  [
    'outre_mer',
    [
      'outre mer',
      'dom tom',
      'guadeloupe',
      'martinique',
      'guyane',
      'la reunion',
      'reunion',
      'mayotte',
      'saint denis de la reunion',
      'pointe a pitre',
      'fort de france',
      'cayenne',
      'saint pierre et miquelon',
      'nouvelle caledonie',
      'noumea',
      'tahiti',
      'polynesie',
    ],
  ],
  [
    'ile_de_france',
    [
      'ile de france',
      'idf',
      'paris',
      'parisien*',
      'region parisienne',
      'banlieue parisienne',
      'seine saint denis',
      'hauts de seine',
      'val de marne',
      'val d oise',
      'seine et marne',
      'essonne',
      'yvelines',
      'boulogne billancourt',
      'saint denis',
      'argenteuil',
      'montreuil',
      'creteil',
      'nanterre',
      'versailles',
      'vitry sur seine',
      'colombes',
      'aulnay sous bois',
      'aubervilliers',
      'asnieres',
      'rueil malmaison',
      'champigny',
      'saint maur',
      'drancy',
      'issy les moulineaux',
      'noisy le grand',
      'levallois',
      'neuilly',
      'cergy',
      'evry',
      'meaux',
      'melun',
      'massy',
      'marne la vallee',
      'saint germain en laye',
      'bobigny',
      'ivry',
      'clichy',
      'antony',
      'sarcelles',
      'pontoise',
    ],
  ],
  [
    'auvergne_rhone_alpes',
    [
      'auvergne',
      'rhone alpes',
      'auvergne rhone alpes',
      'aura',
      'lyon',
      'lyonnais*',
      'villeurbanne',
      'venissieux',
      'bron',
      'caluire',
      'grenoble',
      'grenoblois*',
      'saint etienne',
      'stephanois*',
      'clermont ferrand',
      'clermont',
      'annecy',
      'chambery',
      'savoie',
      'haute savoie',
      'savoyard*',
      'valence',
      'villefranche sur saone',
      'bourg en bresse',
      'roanne',
      'vienne',
      'annemasse',
      'thonon',
      'aix les bains',
      'vichy',
      'montlucon',
      'moulins',
      'aurillac',
      'le puy en velay',
      'privas',
      'ain',
      'isere',
      'drome',
      'ardeche',
      'loire',
      'rhone',
      'cantal',
      'allier',
      'puy de dome',
      'haute loire',
    ],
  ],
  [
    'provence_alpes_cote_d_azur',
    [
      'paca',
      'provence',
      'provencal*',
      'cote d azur',
      'marseille',
      'marseillais*',
      'nice',
      'nicois*',
      'toulon',
      'aix en provence',
      'aix',
      'avignon',
      'antibes',
      'cannes',
      'frejus',
      'hyeres',
      'la seyne',
      'aubagne',
      'martigues',
      'grasse',
      'cagnes',
      'arles',
      'salon de provence',
      'gap',
      'digne',
      'menton',
      'vaucluse',
      'var',
      'bouches du rhone',
      'alpes maritimes',
      'hautes alpes',
      'alpes de haute provence',
    ],
  ],
  [
    'occitanie',
    [
      'occitanie',
      'toulouse',
      'toulousain*',
      'montpellier',
      'montpellierain*',
      'nimes',
      'perpignan',
      'beziers',
      'narbonne',
      'carcassonne',
      'albi',
      'tarbes',
      'montauban',
      'rodez',
      'sete',
      'ales',
      'castres',
      'auch',
      'cahors',
      'foix',
      'mende',
      'lourdes',
      'herault',
      'gard',
      'aude',
      'tarn',
      'aveyron',
      'gers',
      'lot',
      'lozere',
      'ariege',
      'haute garonne',
      'hautes pyrenees',
      'pyrenees orientales',
      'tarn et garonne',
    ],
  ],
  [
    'nouvelle_aquitaine',
    [
      'nouvelle aquitaine',
      'aquitaine',
      'bordeaux',
      'bordelais*',
      'limoges',
      'poitiers',
      'pau',
      'la rochelle',
      'merignac',
      'pessac',
      'bayonne',
      'biarritz',
      'anglet',
      'pays basque',
      'basque*',
      'angouleme',
      'niort',
      'perigueux',
      'brive',
      'agen',
      'mont de marsan',
      'dax',
      'arcachon',
      'cognac',
      'rochefort',
      'saintes',
      'gironde',
      'landes',
      'dordogne',
      'charente',
      'charente maritime',
      'correze',
      'creuse',
      'vienne 86',
      'haute vienne',
      'deux sevres',
      'lot et garonne',
      'pyrenees atlantiques',
      'limousin',
      'poitou',
    ],
  ],
  [
    'hauts_de_france',
    [
      'hauts de france',
      'nord pas de calais',
      'picardie',
      'ch ti',
      'chti',
      'lille',
      'lillois*',
      'amiens',
      'roubaix',
      'tourcoing',
      'dunkerque',
      'calais',
      'boulogne sur mer',
      'valenciennes',
      'arras',
      'lens',
      'douai',
      'beauvais',
      'compiegne',
      'saint quentin',
      'villeneuve d ascq',
      'maubeuge',
      'cambrai',
      'laon',
      'soissons',
      'creil',
      'nord',
      'pas de calais',
      'somme',
      'oise',
      'aisne',
    ],
  ],
  [
    'grand_est',
    [
      'grand est',
      'alsace',
      'alsacien*',
      'lorraine',
      'lorrain*',
      'champagne',
      'strasbourg',
      'strasbourgeois*',
      'reims',
      'metz',
      'nancy',
      'mulhouse',
      'colmar',
      'troyes',
      'charleville',
      'chalons',
      'epinal',
      'thionville',
      'haguenau',
      'saint dizier',
      'verdun',
      'forbach',
      'sarreguemines',
      'moselle',
      'bas rhin',
      'haut rhin',
      'vosges',
      'marne',
      'haute marne',
      'ardennes',
      'meuse',
      'meurthe et moselle',
    ],
  ],
  [
    'pays_de_la_loire',
    [
      'pays de la loire',
      'nantes',
      'nantais*',
      'angers',
      'le mans',
      'saint nazaire',
      'cholet',
      'laval',
      'la roche sur yon',
      'saumur',
      'vendee',
      'vendeen*',
      'sarthe',
      'mayenne',
      'maine et loire',
      'loire atlantique',
    ],
  ],
  [
    'bretagne',
    [
      'bretagne',
      'breton*',
      'rennes',
      'rennais*',
      'brest',
      'quimper',
      'lorient',
      'vannes',
      'saint malo',
      'saint brieuc',
      'lannion',
      'morlaix',
      'finistere',
      'morbihan',
      'cotes d armor',
      'ille et vilaine',
    ],
  ],
  [
    'normandie',
    [
      'normandie',
      'normand*',
      'rouen',
      'le havre',
      'caen',
      'cherbourg',
      'evreux',
      'dieppe',
      'alencon',
      'lisieux',
      'saint lo',
      'calvados',
      'manche',
      'orne',
      'eure',
      'seine maritime',
    ],
  ],
  [
    'centre_val_de_loire',
    [
      'centre val de loire',
      'val de loire',
      'tours',
      'orleans',
      'bourges',
      'blois',
      'chartres',
      'chateauroux',
      'dreux',
      'vierzon',
      'montargis',
      'loiret',
      'indre',
      'indre et loire',
      'cher',
      'eure et loir',
      'loir et cher',
      'sologne',
      'touraine',
    ],
  ],
  [
    'bourgogne_franche_comte',
    [
      'bourgogne',
      'franche comte',
      'dijon',
      'besancon',
      'belfort',
      'chalon sur saone',
      'auxerre',
      'macon',
      'nevers',
      'montbeliard',
      'sens',
      'dole',
      'vesoul',
      'lons le saunier',
      'cote d or',
      'doubs',
      'jura',
      'nievre',
      'yonne',
      'saone et loire',
      'haute saone',
    ],
  ],
  ['corse', ['corse', 'ajaccio', 'bastia', 'porto vecchio', 'calvi', 'corte']],
  [
    'belgium',
    [
      'belgique',
      'belge*',
      'bruxelles',
      'liege',
      'charleroi',
      'namur',
      'mons',
      'anvers',
      'gand',
      'wallonie',
      'louvain',
    ],
  ],
  [
    'switzerland',
    [
      'suisse*',
      'geneve',
      'genevois*',
      'lausanne',
      'zurich',
      'berne',
      'bale',
      'neuchatel',
      'fribourg',
      'sion',
      'valais',
      'vaud',
      'lugano',
    ],
  ],
  ['luxembourg', ['luxembourg*']],
  ['monaco', ['monaco', 'monegasque*']],
  ['canada', ['canada', 'canadien*', 'quebec*', 'montreal', 'ottawa', 'toronto', 'vancouver']],
  ['morocco', ['maroc', 'marocain*', 'casablanca', 'rabat', 'marrakech', 'tanger', 'agadir', 'fes']],
  ['algeria', ['algerie', 'algerien*', 'alger', 'oran', 'constantine', 'annaba']],
  ['tunisia', ['tunisie', 'tunisien*', 'tunis', 'sfax', 'sousse']],
  ['senegal', ['senegal*', 'dakar']],
  ['ivory_coast', ['cote d ivoire', 'ivoirien*', 'abidjan']],
  ['spain', ['espagne', 'espagnol*', 'madrid', 'barcelone', 'valence espagne', 'seville']],
  ['italy', ['italie', 'italien*', 'rome', 'milan', 'turin', 'naples']],
  ['germany', ['allemagne', 'allemand*', 'berlin', 'munich', 'francfort', 'hambourg', 'cologne']],
  ['portugal', ['portugal', 'portugais*', 'lisbonne', 'porto']],
  ['netherlands', ['pays bas', 'hollande', 'amsterdam', 'rotterdam']],
  ['united_kingdom', ['angleterre', 'royaume uni', 'londres', 'uk', 'ecosse', 'manchester']],
  [
    'united_states',
    ['etats unis', 'usa', 'amerique', 'new york', 'los angeles', 'miami', 'chicago', 'texas', 'floride'],
  ],
];

/** A postcode (« 69003 ») or a département's number (« 74 », « 2A »), when the value says one. */
function departmentOf(words: readonly string[]): FanPlace | null {
  for (const word of words) {
    if (/^(97[1-6])\d{2}$/.test(word)) return 'outre_mer';
    if (/^\d{5}$/.test(word)) {
      const place = DEPARTMENTS[word.slice(0, 2)];
      if (place !== undefined) return place;
    }
    if (/^(\d{2,3}|2a|2b)$/.test(word)) {
      const place = DEPARTMENTS[word];
      if (place !== undefined) return place;
    }
  }
  return null;
}

/** The region in France, or the country outside it; `null` when nothing is recognised (it goes to « Autres »). */
export function placeOf(value: string): FanPlace | null {
  const words = wordsOf(value);
  return longestOf(PLACES, words) ?? departmentOf(words);
}

// --- Job (ADR 0074 § 5) -----------------------------------------------------------------------------------------

/** Out of work: « Autres », whatever else the value says (« ancien militaire au chômage »). */
const NO_JOB = [
  'chomage',
  'chomeur*',
  'sans emploi',
  'sans travail',
  'sans boulot',
  'en recherche',
  'rsa',
  'demandeur d emploi',
  'pole emploi',
  'france travail',
  'invalidite',
].map(matcher);

/** In this order: « retraité de l'armée » is retired, « étudiant en médecine » a student, « plombier à son compte » a builder. */
const JOBS: Table<JobFamily> = [
  ['retired', ['retraite*', 'a la retraite', 'pensionne*']],
  [
    'student',
    [
      'etudiant*',
      'etudes',
      'fac',
      'universite',
      'alternan*',
      'apprenti*',
      'stagiaire',
      'lyceen*',
      'bts',
      'en master',
      'en licence',
      'doctorant*',
      'interne',
    ],
  ],
  [
    'health',
    [
      'infirmi*',
      'aide soignant*',
      'soignant*',
      'medecin*',
      'docteur',
      'chirurgien*',
      'pharmac*',
      'kine*',
      'dentiste',
      'sage femme',
      'ambulanc*',
      'psycholog*',
      'psychiatre',
      'osteo*',
      'veterinaire',
      'hopital',
      'ehpad',
      'auxiliaire de vie',
      'aide a domicile',
      'brancardier',
      'radiolog*',
      'orthophonist*',
      'opticien*',
      'laborantin*',
      'manipulateur radio',
      'sante',
      'medical*',
    ],
  ],
  [
    'teaching',
    [
      'prof*',
      'enseignant*',
      'instit*',
      'maitre de conference*',
      'chercheur*',
      'educat*',
      'formateur*',
      'formatrice*',
      'atsem',
      'animateur*',
      'surveillant*',
      'aesh',
      'recherche',
    ],
  ],
  [
    'engineering',
    [
      'informati*',
      'developpeu*',
      'dev',
      'ingenieur*',
      'it',
      'data',
      'programmeur*',
      'admin systeme',
      'administrateur systeme*',
      'reseau*',
      'cyber*',
      'devops',
      'web',
      'tech',
      'technicien informatique',
      'dans l info',
      'logiciel*',
      'informatique',
      'electronic*',
      'telecom*',
    ],
  ],
  [
    'security',
    [
      'militaire',
      'soldat',
      'armee',
      'legionnaire',
      'marine nationale',
      'gendarme*',
      'policier*',
      'police',
      'pompier*',
      'agent de securite',
      'securite',
      'vigile',
      'douan*',
      'fonctionnaire',
      'mairie',
      'fonction publique',
      'agent territorial',
      'surveillant penitentiaire',
      'maton',
      'agent de surete',
    ],
  ],
  [
    'transport',
    [
      'chauffeur*',
      'routier*',
      'livreu*',
      'cariste',
      'logisti*',
      'magasinier*',
      'preparateur de commande*',
      'conducteur*',
      'pilote',
      'steward',
      'hotesse de l air',
      'taxi',
      'vtc',
      'transport*',
      'manutention*',
      'docker',
      'cheminot',
      'sncf',
      'ratp',
      'aiguilleur*',
      'controleur*',
      'marin',
    ],
  ],
  [
    'hospitality',
    [
      'cuisini*',
      'chef cuisinier',
      'serveu*',
      'barman',
      'barmaid',
      'restaura*',
      'hotel*',
      'receptionniste',
      'plongeur',
      'commis',
      'pizzaiolo',
      'traiteur',
      'tourisme',
      'saisonnier*',
      'fast food',
      'mcdo',
    ],
  ],
  [
    'agriculture',
    [
      'agricult*',
      'paysan*',
      'eleveur*',
      'viticult*',
      'vigneron*',
      'maraich*',
      'jardinier*',
      'paysagiste',
      'forestier*',
      'bucheron*',
      'horticult*',
      'ferme',
      'fermier*',
      'agricole',
      'environnement',
    ],
  ],
  [
    'arts',
    [
      'artiste',
      'musicien*',
      'photograph*',
      'graphiste',
      'designer',
      'journaliste',
      'comedien*',
      'acteur',
      'actrice',
      'danseu*',
      'sportif',
      'coach*',
      'footballeur',
      'streamer',
      'youtubeur',
      'influenceu*',
      'ecrivain',
      'auteur',
      'dessinat*',
      'tatoueu*',
      'dj',
      'monteur video',
      'producteur',
      'realisateur',
      'audiovisuel',
      'cinema',
      'musique',
      'sport',
    ],
  ],
  [
    'building',
    [
      'macon*',
      'electricien*',
      'plombier*',
      'menuisier*',
      'charpentier*',
      'couvreur*',
      'peintre*',
      'carreleur*',
      'platrier*',
      'btp',
      'batiment',
      'chantier*',
      'ouvrier*',
      'usine',
      'mecanicien*',
      'mecanique',
      'soudeur*',
      'operateur*',
      'technicien*',
      'maintenance',
      'artisan*',
      'boulanger*',
      'boucher*',
      'patissier*',
      'charcutier*',
      'coiffeu*',
      'esthetic*',
      'garagiste',
      'carrossier*',
      'industrie*',
      'production',
      'chaudronnier*',
      'frigoriste',
      'chauffagiste',
      'serrurier*',
      'ebeniste',
      'tourneur*',
      'fraiseur*',
      'cordiste',
      'grutier*',
      'terrassier*',
    ],
  ],
  [
    'sales',
    [
      'commercia*',
      'vendeu*',
      'vente*',
      'caissi*',
      'magasin',
      'conseiller de vente',
      'conseiller clientele',
      'agent immobilier',
      'immobilier',
      'manager de rayon',
      'chef de rayon',
      'commerce',
      'employe libre service',
      'mise en rayon',
      'grande distribution',
      'supermarche',
      'negociateur*',
      'business developer',
    ],
  ],
  [
    'office',
    [
      'comptab*',
      'banqu*',
      'assurance*',
      'avocat*',
      'juriste',
      'notaire',
      'huissier',
      'assistant*',
      'secretaire',
      'rh',
      'ressources humaines',
      'cadre',
      'consultant*',
      'finance*',
      'gestionnaire',
      'auditeur*',
      'audit',
      'administrati*',
      'bureau',
      'chef de projet',
      'directeur*',
      'manager',
      'employe de bureau',
      'trader',
      'expert comptable',
      'controleur de gestion',
      'marketing',
      'communication',
      'call center',
      'teleconseiller*',
    ],
  ],
  [
    'self_employed',
    [
      'independant*',
      'auto entrepreneur*',
      'micro entrepreneur*',
      'freelance*',
      'chef d entreprise',
      'entrepreneur*',
      'patron',
      'gerant*',
      'a mon compte',
      'a son compte',
      'mon entreprise',
      'ma boite',
      'business',
    ],
  ],
];

/** The job family, or `null` (« Autres »): out of work, or not recognised. */
export function jobFamilyOf(value: string): JobFamily | null {
  const words = wordsOf(value);
  if (NO_JOB.some((m) => m(words))) return null;
  return firstOf(JOBS, words);
}

// --- Situation (ADR 0074 § 6) -----------------------------------------------------------------------------------

const SITUATIONS: Table<FanSituation> = [
  ['separated', ['separe*', 'divorce*', 'en instance de divorce', 'en rupture', 'vient de rompre']],
  [
    'single',
    [
      'celibataire',
      'celib',
      'single',
      'seul',
      'seule',
      'libre',
      'pas en couple',
      'plus en couple',
      'pas marie*',
      'personne dans ma vie',
    ],
  ],
  ['married', ['marie', 'mariee', 'marie depuis', 'epoux', 'ma femme', 'mon mari', 'en menage']],
  [
    'couple',
    ['en couple', 'couple', 'ma copine', 'ma compagne', 'ma meuf', 'en relation', 'pacse*', 'fiance*'],
  ],
];

/** His situation, or `null` (« Autres »: widowed, « c'est compliqué », anything else). */
export function situationOf(value: string): FanSituation | null {
  return firstOf(SITUATIONS, wordsOf(value));
}

// --- Shares (ADR 0065 § 4, ADR 0074 § 8) ------------------------------------------------------------------------

/** Rounded to ten, never below: « environ 40 de tes fans l'ont dit ». */
export const aboutTen = (count: number): number => Math.round(count / 10) * 10;

/** A count of fans as she reads it: rounded to ten, never under ten, `null` under the threshold (ADR 0074 § 8). */
export const countOf = (count: number): number | null =>
  count < FAN_FIGURES_MIN_FANS ? null : Math.max(FAN_FIGURES_MIN_FANS, aboutTen(count));

/** Whole shares of `counts` summing to 100, by the largest remainder; empty when nothing is counted. */
export function sharesOf(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((n) => (n * 100) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, n) => sum + n, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left === 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

export type Ranked<K extends string> =
  | { readonly status: 'too_few' }
  | {
      readonly status: 'enough';
      readonly aboutFans: number;
      readonly cases: readonly { readonly key: K | typeof OTHER_CASE; readonly share: number }[];
    };

/**
 * One block from one case per fan (`null` for « Autres »): `too_few` under `FAN_FIGURES_MIN_FANS` fans; otherwise a
 * case under `FAN_FIGURES_MIN_CASE` fans joins « Autres », and past `top` named cases, the rest does too. `order`
 * keeps fixed cases in their order (ages, situations); without it, the most cited first.
 */
export function rank<K extends string>(
  cases: readonly (K | null)[],
  options: { readonly top?: number; readonly order?: readonly K[] } = {},
): Ranked<K> {
  if (cases.length < FAN_FIGURES_MIN_FANS) return { status: 'too_few' };
  const counts = new Map<K, number>();
  let other = 0;
  for (const key of cases) {
    if (key === null) other += 1;
    else counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let named = [...counts.entries()].filter(([, n]) => {
    if (n >= FAN_FIGURES_MIN_CASE) return true;
    other += n;
    return false;
  });
  if (options.order === undefined) {
    named.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (options.top !== undefined && named.length > options.top) {
      for (const [, n] of named.slice(options.top)) other += n;
      named = named.slice(0, options.top);
    }
  } else {
    const order = options.order;
    named.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }
  const otherCase: (typeof OTHER_CASE)[] = other > 0 ? [OTHER_CASE] : [];
  const keys: (K | typeof OTHER_CASE)[] = [...named.map(([key]) => key), ...otherCase];
  const shares = sharesOf([...named.map(([, n]) => n), ...(other > 0 ? [other] : [])]);
  return {
    status: 'enough',
    aboutFans: aboutTen(cases.length),
    cases: keys.map((key, i) => ({ key, share: shares[i] ?? 0 })),
  };
}

// --- The whole panel (ADR 0065 § 3, ADR 0074) --------------------------------------------------------------------

/** One fact that counts (ADR 0074 § 1): the latest of a fan for a key, active at midnight. */
interface FigureFact {
  readonly fanId: string;
  readonly key: FigureKey;
  readonly value: string;
}

/** What the reader counts at midnight, in her time zone; spending in euro cents, VAT included. */
export interface FigureInput {
  readonly asOf: Date;
  readonly fans: { readonly total: number; readonly newLast30Days: number; readonly wroteLast7Days: number };
  readonly facts: readonly FigureFact[];
  /** What each of her fans unlocked in all, in euro cents (0 when nothing). */
  readonly spentMinor: readonly number[];
  /** What each fan who paid over the last 30 days unlocked over them, in euro cents (> 0). */
  readonly basketsMinor: readonly number[];
  /** Fans who unlocked at least one message, in any currency. */
  readonly payingFans: number;
  /** Her fans' messages over the last 30 days, by day (0 = Monday) and slot of three hours, in her time zone. */
  readonly activity: readonly { readonly day: number; readonly slot: number; readonly messages: number }[];
  /** How many fans wrote those messages. */
  readonly activeFans: number;
}

const AGE_ORDER = ['18_24', '25_34', '35_44', '45_54', '55_plus'] as const;
const SITUATION_ORDER = ['single', 'couple', 'married', 'separated'] as const;
const TIER_ORDER = ['none', 'under_20', '20_100', '100_500', 'over_500'] as const;

function spendingTierOf(minor: number): (typeof TIER_ORDER)[number] {
  if (minor <= 0) return 'none';
  if (minor < 2_000) return 'under_20';
  if (minor <= 10_000) return '20_100';
  if (minor <= 50_000) return '100_500';
  return 'over_500';
}

/** The panel « Qui sont tes fans »: shares only, each block under its threshold as `too_few` (ADR 0074 § 8). */
export function fanFigures(input: FigureInput): CreatorFanInsights {
  const valuesOf = (key: FigureKey) => input.facts.filter((f) => f.key === key).map((f) => f.value);
  const ages = valuesOf('age')
    .map(ageOf)
    .filter((age): age is number => age !== null);
  const ageBlock = rank(ages.map(ageBandOf), { order: AGE_ORDER });
  const days = input.activity.reduce((sum, cell) => sum + cell.messages, 0);
  const cellShares = sharesOf(input.activity.map((cell) => cell.messages));
  const tiers = rank(input.spentMinor.map(spendingTierOf), { order: TIER_ORDER });
  const enoughBaskets = input.basketsMinor.length >= FAN_FIGURES_MIN_FANS;
  return {
    asOf: input.asOf.toISOString(),
    fans: {
      total: countOf(input.fans.total),
      newLast30Days: countOf(input.fans.newLast30Days),
      wroteLast7Days: countOf(input.fans.wroteLast7Days),
    },
    age:
      ageBlock.status === 'too_few'
        ? ageBlock
        : {
            ...ageBlock,
            cases: [...ageBlock.cases],
            averageAge: Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length),
          },
    place: mutable(rank(valuesOf('location').map(placeOf), { top: FAN_FIGURES_TOP })),
    job: mutable(rank(valuesOf('job').map(jobFamilyOf), { top: FAN_FIGURES_TOP })),
    situation: mutable(rank(valuesOf('situation').map(situationOf), { order: SITUATION_ORDER })),
    spending:
      tiers.status === 'too_few'
        ? tiers
        : {
            status: 'enough',
            payingShare: sharesOf([input.payingFans, input.spentMinor.length - input.payingFans])[0] ?? 0,
            averageBasketMinor: enoughBaskets
              ? Math.round(input.basketsMinor.reduce((sum, n) => sum + n, 0) / input.basketsMinor.length)
              : null,
            cases: [...tiers.cases],
          },
    activity:
      input.activeFans < FAN_FIGURES_MIN_FANS || days === 0
        ? { status: 'too_few' }
        : {
            status: 'enough',
            cells: input.activity.map((cell, i) => ({
              day: cell.day,
              slot: cell.slot,
              share: cellShares[i] ?? 0,
            })),
          },
  };
}

function mutable<K extends string>(ranked: Ranked<K>) {
  return ranked.status === 'too_few' ? ranked : { ...ranked, cases: [...ranked.cases] };
}
