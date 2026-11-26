import type { NavIconName } from '@/shell/NavIcon';

/**
 * Le guide d'Impera, par personne (demande de Charles du 21/11, style validé le 21/11) : ce que chacun doit savoir
 * pour faire son travail, les gestes difficiles pas à pas, et les vraies questions. Données, pas de logique : une règle
 * métier se lit dans le code qui l'applique, ce texte ne fait que l'expliquer. Seul ce qui est à l'écran sur main est
 * écrit ici ; un geste en file arrive avec sa PR. `<kbd>X</kbd>` marque une touche du clavier.
 */

/** Who a book is for: the rail's kind (`railKindOf`), the operator without a team reading the chatter's. */
export type HelpAudience = 'owner' | 'manager' | 'chatter' | 'creator';

/** What a chip's dot means: the colour of the state it names on screen. */
export type HelpTone = 'go' | 'warn' | 'danger' | 'ok';

export interface HelpStep {
  /** The gesture, with its words as the screen writes them. */
  readonly do: string;
  /** What the person must see once it is done: the proof it worked. */
  readonly see: string;
}

export interface HelpGuide {
  readonly id: string;
  readonly icon: NavIconName;
  readonly title: string;
  readonly summary: string;
  readonly minutes: string;
  readonly essential?: boolean;
  readonly why?: string;
  readonly chips?: readonly { readonly tone: HelpTone; readonly text: string }[];
  readonly steps: readonly HelpStep[];
  /** « À savoir ». */
  readonly rule?: readonly string[];
  /** « Jamais », in the danger colour. */
  readonly never?: readonly string[];
  /** « Si ça coince », in amber. */
  readonly stuck?: readonly string[];
}

export interface HelpBook {
  /** The answer first: what this space is for, in one sentence. */
  readonly lead: string;
  /** The day in three beats. */
  readonly day: readonly { readonly title: string; readonly text: string }[];
  readonly guides: readonly HelpGuide[];
  readonly faq: readonly { readonly q: string; readonly a: string }[];
}

export const HELP: Readonly<Record<HelpAudience, HelpBook>> = {
  owner: {
    lead: 'Tu règles l’agence ; l’IA et l’équipe font le reste sous ton contrôle.',
    day: [
      {
        title: 'Le Dashboard',
        text: 'Urgences, objectif du jour, ventes : ce qui demande ta main est en haut.',
      },
      {
        title: 'Les réglages fins',
        text: 'Une créatrice, une persona, un script, la paie : seulement quand c’est à toi.',
      },
      { title: 'Le soir', text: 'Un coup d’œil au coût de l’IA et aux rapports de l’équipe.' },
    ],
    guides: [
      {
        id: 'choisir-le-mode-de-l-ia',
        icon: 'settings',
        title: 'Choisir le mode de l’IA',
        summary: 'Automatique, Copilote ou Arrêt',
        minutes: '1 min',
        essential: true,
        why: 'C’est l’interrupteur le plus important d’Impera : il décide si l’IA écrit seule, si un chatteur valide chaque message, ou si elle se tait.',
        chips: [
          {
            tone: 'go',
            text: 'Automatique : elle envoie seule',
          },
          {
            tone: 'ok',
            text: 'Copilote : un chatteur valide tout',
          },
          {
            tone: 'danger',
            text: 'Arrêt : elle n’écrit plus rien',
          },
        ],
        steps: [
          {
            do: 'Dashboard, choisis la créatrice : le contrôle du mode, à trois choix.',
            see: 'Automatique, Copilote, Arrêt ; celui en cours allumé.',
          },
          {
            do: 'Choisis Copilote pour commencer.',
            see: '« Copilote » allumé ; les brouillons arrivent chez les chatteurs.',
          },
          {
            do: 'Automatique reste verrouillé tant que ses conditions manquent : survole-le.',
            see: 'ce qui manque : persona active, 80 % de brouillons gardés sans retouche sur 100 décidés de cette version, test à l’aveugle passé.',
          },
        ],
        rule: [
          'Arrêt est immédiat, après une confirmation qui dit ce qui s’arrête et ce qui reste. En cas de doute, coupe d’abord, comprends ensuite.',
          'Choisir Automatique redemande ton code à deux facteurs.',
          'Le mode vaut par créatrice.',
        ],
        stuck: ['Automatique ne s’ouvre pas : c’est voulu, le survol dit le chiffre qui manque.'],
      },
      {
        id: 'mettre-une-creatrice-en-route',
        icon: 'creators',
        title: 'Mettre une créatrice en route',
        summary: 'La carte « Mise en route », étape par étape',
        minutes: '30 min',
        essential: true,
        why: 'Une créatrice ne travaille bien qu’une fois tout branché. La carte compte les étapes faites et ouvre la suivante d’un clic.',
        steps: [
          {
            do: 'Créatrices, nouvelle créatrice, puis Dashboard : carte « Mise en route ».',
            see: '« 0 sur 10 » et l’étape suivante.',
          },
          {
            do: 'Suis l’ordre : compte Reveal, persona, part de l’agence, son accès, règles de paie, groupe Telegram, heures de l’IA, shifts.',
            see: 'chaque ligne cochée par le serveur, pas par toi.',
          },
          {
            do: 'Finis par la vérification de fiabilité, sur une quinzaine passée.',
            see: '« Vérification propre ».',
          },
        ],
        stuck: [
          'Une étape ne se coche pas : ouvre-la, la phrase grise dit ce qui manque.',
          'Son lien d’accès a expiré : « Nouveau lien ».',
        ],
      },
      {
        id: 'activer-une-persona',
        icon: 'clapper',
        title: 'Activer une persona',
        summary: 'Ce que l’IA sait d’elle et sa façon de parler',
        minutes: '15 min',
        why: 'L’IA écrit avec la version active. Sans version active, elle n’écrit rien.',
        steps: [
          {
            do: 'Créatrices, sa fiche, onglet Persona.',
            see: 'la version active et les brouillons.',
          },
          {
            do: 'Relis le brouillon proposé, corrige ce qui sonne faux.',
            see: 'le brouillon prêt à activer.',
          },
          {
            do: '« Activer ».',
            see: 'la nouvelle version active ; l’ancienne reste gardée.',
          },
        ],
        rule: [
          'Une persona proposée n’est qu’un brouillon : toi seul l’actives.',
          'Revenir en arrière : « Réactiver la version N ».',
        ],
      },
      {
        id: 'choisir-son-coffre',
        icon: 'content',
        title: 'Choisir son coffre',
        summary: 'Les médias qu’Impera peut proposer',
        minutes: '5 min',
        essential: true,
        why: 'L’IA ne vend que si la vente est activée pour la créatrice et qu’elle a au moins trois scripts jouables. Tout part des médias que tu choisis.',
        steps: [
          {
            do: 'Sa fiche, onglet Médias, vue Coffre : « Choisir dans Reveal ».',
            see: 'son coffre Reveal relu ; rien n’entre par défaut.',
          },
          {
            do: 'Coche les médias voulus, puis « Importer ».',
            see: '« Importé ».',
          },
        ],
        never: ['Revendre un média offert, ou offrir un média de script.'],
      },
      {
        id: 'ecrire-un-script',
        icon: 'clapper',
        title: 'Écrire un script',
        summary: 'Dans Impera, puis recopié à la main dans Reveal',
        minutes: '20 min',
        essential: true,
        why: 'Impera n’écrit jamais dans Reveal : il prépare tout, l’équipe recopie.',
        steps: [
          {
            do: 'Sa fiche, onglet Scripts, « ＋ Nouveau script » : nom, idée, moment (Jour, Nuit, ou Jour et nuit), puis « Créer le brouillon ».',
            see: 'le brouillon et ses étapes vides.',
          },
          {
            do: 'Remplis chaque étape : texte, « Choisir des médias », prix.',
            see: '« Rien ne manque ».',
          },
          {
            do: '« Prêt à copier dans Reveal ».',
            see: 'le script dans la vue « À copier ».',
          },
          {
            do: 'Vue « À copier » : copie le nom, les textes, les médias dans l’ordre et les prix, un bouton chacun, dans Reveal.',
            see: 'tout recopié dans Reveal.',
          },
          {
            do: 'Rien à confirmer : à l’import suivant…',
            see: '« Reconnu dans Reveal ».',
          },
        ],
        rule: [
          'En « Jour et nuit », Impera alterne seul.',
          'Un média remplacé dans un script déjà recopié le fait repasser « à recopier ».',
        ],
        never: ['Créer un script dans Reveal pour l’importer : toujours dans Impera d’abord.'],
      },
      {
        id: 'un-script-tourne-par-elle',
        icon: 'creators',
        title: 'Un script tourné par elle',
        summary: 'À partir d’une structure',
        minutes: '15 min',
        why: 'Tu décris la structure, elle tourne, Impera prépare la fiche à recopier.',
        steps: [
          {
            do: 'Créatrices › « Structures de script » › « Nouvelle structure » (toi seul).',
            see: 'la structure enregistrée.',
          },
          {
            do: 'Sa fiche, onglet Agenda › Demandes, « Demander un contenu », puis « Demander ».',
            see: 'la demande chez elle, dans « À tourner ».',
          },
          {
            do: 'Elle tourne et envoie.',
            see: 'le script dans « À copier » : « En vérification », puis « À recopier ».',
          },
          {
            do: '« Télécharger l’archive », recopie dans Reveal en suivant la fiche.',
            see: 'tout recopié dans Reveal.',
          },
          {
            do: '« Copié dans Reveal », puis confirme.',
            see: 'le script confirmé ; ses originaux partent 30 jours plus tard.',
          },
        ],
      },
      {
        id: 'une-alerte-urgente',
        icon: 'bell',
        title: 'Une alerte urgente',
        summary: 'Doute sur l’âge, détresse, rencontre',
        minutes: '2 min',
        essential: true,
        why: 'L’IA s’arrête d’elle-même sur ces fans. Elle attend un humain, et elle ne reprend pas toute seule.',
        chips: [
          {
            tone: 'danger',
            text: 'Urgent : ouvrir tout de suite',
          },
          {
            tone: 'warn',
            text: 'Important : dès que possible',
          },
        ],
        steps: [
          {
            do: 'Ouvre le lien de l’alerte (Telegram ou Suivi › Alertes).',
            see: 'la conversation et la raison de l’alerte.',
          },
          {
            do: '« Reprendre la main ».',
            see: '« Tu as la main » ; l’équipe voit qu’un humain a repris.',
          },
          {
            do: 'Quand c’est réglé, « Rendre la main à l’agent » (ou « avec la note » si tu en as écrit une).',
            see: 'l’IA reprend ce fan, sauf dans les deux cas graves ci-dessous.',
          },
        ],
        never: [
          'Doute sur l’âge : rendre la main ne suffit pas. L’IA n’écrit rien tant que toi ou un manager n’avez pas confirmé son âge, avec une raison, sur la fiche du fan.',
          'Fan en difficulté : ventes gelées et rien d’explicite jusqu’à « Il va mieux », puis encore 30 jours.',
        ],
      },
      {
        id: 'une-demande-sur-mesure',
        icon: 'creators',
        title: 'Une demande sur mesure',
        summary: 'Un fan veut quelque chose rien que pour lui',
        minutes: '5 min',
        why: 'Rien n’est promis au fan avant l’accord de la créatrice. Impera rassemble la demande, puis la lui transmet.',
        steps: [
          {
            do: 'Un chatteur est en shift : la conversation lui passe tout de suite.',
            see: 'la conversation chez le chatteur.',
          },
          {
            do: 'Sinon, l’IA dit qu’elle va réfléchir, puis demande les précisions une par une.',
            see: 'ni oui, ni non, ni prix, ni délai côté fan.',
          },
          {
            do: 'Demande complète : la fiche part chez la créatrice.',
            see: 'sa réponse sur la demande.',
          },
          {
            do: 'Si elle accepte, le prix part avec un acompte de moitié.',
            see: 'l’acompte demandé au fan.',
          },
        ],
        rule: ['Si sa grille dit qu’elle ne le fait pas, l’IA refuse avec douceur.'],
        never: ['Ni oui, ni prix au fan avant l’accord de la créatrice.'],
      },
      {
        id: 'cloturer-la-quinzaine',
        icon: 'pay',
        title: 'Clôturer la quinzaine',
        summary: 'Rapports, primes, factures, exports',
        minutes: '20 min',
        why: 'La paie se calcule seule, à partir des rapports de fin de shift validés, ou des ventes lues sur Reveal pour les comptes payés ainsi. Ton travail : vérifier et décider des primes.',
        steps: [
          {
            do: 'Paie › Quinzaine.',
            see: 'le relevé de chaque membre, calculé.',
          },
          {
            do: 'Primes et malus : une prime, un ajustement, toujours avec un motif.',
            see: 'la ligne ajoutée au relevé.',
          },
          {
            do: '« Valider les relevés ».',
            see: 'chaque relevé validé ; les factures émises au nom de chaque membre.',
          },
          {
            do: 'Verse, puis « Marquer payé ».',
            see: 'le relevé payé.',
          },
          {
            do: 'Exports, pour le comptable.',
            see: 'le fichier de la quinzaine.',
          },
        ],
        rule: ['Une prime ou un ajustement : toi seul. Un malus : le manager peut.'],
        stuck: [
          'Clôture refusée : le dernier taux de change est trop ancien. Réessaie plus tard, rien n’est payé sur un taux deviné.',
        ],
      },
      {
        id: 'surveiller-le-cout-de-l-ia',
        icon: 'pay',
        title: 'Surveiller le coût de l’IA',
        summary: 'Le plafond du jour',
        minutes: '1 min',
        why: 'L’IA s’arrête d’écrire au plafond du jour que tu as fixé, jusqu’à minuit. Les chatteurs reprennent alors à la main.',
        steps: [
          {
            do: 'Réglages › Consommation IA.',
            see: 'la dépense du jour, la courbe et la prévision du mois.',
          },
          {
            do: 'Règle le plafond et l’alerte.',
            see: 'les deux montants enregistrés.',
          },
        ],
      },
      {
        id: 'brancher-un-agent-ia',
        icon: 'shield',
        title: 'Brancher un agent IA',
        summary: 'Claude sur ton PC lit tes chiffres',
        minutes: '5 min',
        why: 'Ton agent répond à « fais-moi le point du jour » avec les vrais chiffres, le planning et les brouillons en attente, sans que tu ouvres chaque écran.',
        steps: [
          {
            do: 'Réglages › Agents connectés : « Connecter un agent », donne-lui un nom, choisis « Toute l’agence » ou une créatrice, coche seulement ce qu’il doit lire.',
            see: 'les interrupteurs allumés en vert, rien n’est coché d’avance.',
          },
          {
            do: '« Créer le jeton », puis confirme ton mot de passe et ton code.',
            see: 'le jeton et la ligne pour Claude Code, montrés une seule fois.',
          },
          {
            do: '« Copier la commande », colle-la dans un terminal du PC où tourne Impera, puis ouvre Claude Code et demande-lui le point du jour.',
            see: 'ton agent dans la liste, avec « dernier appel il y a … ».',
          },
        ],
        rule: [
          'Un agent ne fait que lire : il n’écrit à aucun fan, n’approuve rien, ne touche ni aux prix ni à la paie.',
          'Aucun montant par chatteur ni aucune part ne sort, quoi que tu coches.',
          'Tant qu’Impera tourne sur ton PC, seul un agent sur ce PC le joint.',
        ],
        never: [
          'Coller un jeton dans un fil de discussion, un e-mail ou un fichier partagé.',
          'Cocher « Messages et brouillons » ou « Texte des scripts » pour un agent dont tu ne connais pas le fournisseur.',
        ],
        stuck: [
          'Jeton perdu ou montré par erreur : « Révoquer », puis crée-en un autre.',
          'L’agent dit « non autorisé » : le jeton a expiré ou a été révoqué ; crée-en un nouveau.',
        ],
      },
      {
        id: 'reconnecter-reveal',
        icon: 'puzzle',
        title: 'Reconnecter Reveal',
        summary: 'Quand la session expire',
        minutes: '1 min',
        essential: true,
        why: 'Quand la session Reveal est coupée, l’IA s’arrête. Une minute depuis ton PC la relance.',
        chips: [
          {
            tone: 'ok',
            text: 'Connectée',
          },
          {
            tone: 'warn',
            text: 'Expire bientôt',
          },
          {
            tone: 'danger',
            text: 'Coupée',
          },
          {
            tone: 'ok',
            text: 'Jamais branchée',
          },
        ],
        steps: [
          {
            do: 'Sur ton PC, ouvre Reveal dans Chrome. Déconnecte-toi, puis reconnecte-toi avec le compte d’équipe Reveal réservé à l’IA.',
            see: 'la messagerie de Reveal.',
          },
          {
            do: 'Sur cet onglet, clique l’icône Impera.',
            see: '« Synchronisée à l’ouverture » sur la ligne du compte, si elle a déjà été synchronisée une fois.',
          },
          {
            do: 'Si la ligne n’a pas changé, clique « Synchroniser ».',
            see: '« Connectée ».',
          },
        ],
        stuck: [
          '« Aucune session lue dans cet onglet » : ouvre la messagerie Reveal ici, puis resynchronise.',
          '« Reconnecte-toi à Reveal, puis resynchronise » : la session est trop vieille, refais l’étape 1.',
          'La session se coupe sans arrêt : n’ouvre ce compte que sur ce PC.',
        ],
      },
      {
        id: 'ajouter-un-membre',
        icon: 'team',
        title: 'Ajouter un membre',
        summary: 'De l’invitation à son premier shift',
        minutes: '10 min',
        why: 'Un chatteur ou un manager n’est prêt qu’une fois toutes les lignes de sa mise en route cochées.',
        steps: [
          {
            do: 'Équipe › Membres, « Ajouter un membre ».',
            see: 'sa fiche, avec la carte « Mise en route du membre ».',
          },
          {
            do: 'Envoie-lui son lien d’invitation.',
            see: '« Invité » sur sa ligne, jusqu’à ce qu’il l’ouvre.',
          },
          {
            do: 'De son côté : son mot de passe, sa double authentification, son extension.',
            see: 'ses lignes qui se cochent seules.',
          },
          {
            do: 'Toi : son compte Reveal, ses créatrices (« Modifier »), son premier shift au planning.',
            see: '« Son premier shift » coché.',
          },
        ],
        rule: [
          'Ses ventes ne lui sont attribuées qu’une fois son compte chatteur Reveal relié.',
          'Son taux et son statut se changent sur sa fiche : « Changer le taux » (avec une date d’effet), « Changer le statut ».',
        ],
        stuck: ['« Lien expiré » : « Nouveau lien », sur la ligne « Son invitation ».'],
      },
      {
        id: 'un-fan-a-l-age-douteux',
        icon: 'bell',
        title: 'Un fan à l’âge douteux',
        summary: 'L’IA se tait jusqu’à ce qu’un humain tranche',
        minutes: '2 min',
        why: 'Au moindre doute sur son âge, l’IA n’écrit plus rien à ce fan. Rendre la main ne lève pas ce doute : seule une confirmation écrite le fait.',
        steps: [
          {
            do: 'Suivi, la fiche du fan, « Limites du fan ».',
            see: '« Âge contesté », en ambre.',
          },
          {
            do: 'Si tu as une preuve, « Confirmer son âge », puis écris pourquoi.',
            see: 'la raison demandée (« Pièce d’identité vue, appel vidéo… »), puis « Âge confirmé ».',
          },
        ],
        never: ['Confirmer sans preuve. Dans le doute, on ne lui écrit plus.'],
      },
      {
        id: 'ton-code-a-deux-facteurs',
        icon: 'shield',
        title: 'Ton code à deux facteurs',
        summary: 'Codes de secours, téléphone perdu',
        minutes: '3 min',
        why: 'Sans lui, l’app ne s’ouvre pas. Tes codes de secours sont ta seule porte si tu perds ton téléphone.',
        steps: [
          {
            do: 'Réglages › Sécurité : active la double authentification avec ton application d’authentification.',
            see: 'tes codes de secours.',
          },
          {
            do: 'Recopie tes codes de secours à la main, ou télécharge-les, et range-les hors de ton téléphone.',
            see: 'chaque code ne sert qu’une fois.',
          },
        ],
        stuck: [
          'Téléphone perdu : à la connexion, tape un code de secours dans « Code à 6 chiffres ou de secours », puis refais ta double authentification dans Réglages › Sécurité.',
          'Plus de code de secours : la session de mise en ligne t’aide à rouvrir ton compte.',
        ],
      },
      {
        id: 'essai-de-restauration',
        icon: 'content',
        title: 'Essai de restauration',
        summary: 'Une fois par trimestre',
        minutes: '30 min',
        why: 'Une sauvegarde ne vaut que si on sait la remettre. On le vérifie pour de vrai, chaque trimestre.',
        steps: [
          {
            do: 'Réglages › Sauvegardes, « Essai de restauration ».',
            see: 'les étapes de l’essai.',
          },
          {
            do: 'Une session Claude sur ton PC le joue ; tu approuves chaque étape, sans taper de commande.',
            see: 'l’essai réussi, daté.',
          },
        ],
        rule: ['La paie n’est jamais bloquée par cet essai.'],
      },
    ],
    faq: [
      {
        q: 'Qui voit quoi ?',
        a: 'Le manager voit les ventes et les parts au Dashboard, pas le contrat de la créatrice. Le chatteur voit sa commission sur son accueil, jamais dans l’extension. La modèle voit ses fans en lecture seule.',
      },
      {
        q: 'Est-ce que l’IA dit qu’elle est une IA ?',
        a: 'Jamais. C’est fixé dans le code, ce n’est pas un réglage.',
      },
      {
        q: 'Un fan veut payer ailleurs que sur Reveal ?',
        a: 'Jamais. L’IA refuse et le ramène sur Reveal.',
      },
      {
        q: 'Pourquoi l’IA n’a pas répondu à ce fan ?',
        a: 'Une coupure : doute sur l’âge, fan en difficulté, « Ne plus lui écrire », ventes gelées, un humain tient la conversation, ou le mode Arrêt. Le Suivi dit laquelle.',
      },
      {
        q: 'Pourquoi elle ne lui vend rien ?',
        a: 'Le code décide : moins de 3 scripts jouables, désir encore trop bas, offre trop récente, ou un refus déjà fait. La raison s’affiche sous « Ne rien vendre ».',
      },
      {
        q: 'Je peux changer le prix qu’elle propose ?',
        a: 'Non. Le prix vient du code, dans la fourchette de la créatrice. « Réécrire avec une consigne » ne change que le ton et le contenu.',
      },
      {
        q: 'Telegram n’envoie plus rien ?',
        a: 'Réglages › Telegram, « Remplacer le jeton ».',
      },
      {
        q: 'Pourquoi je suis déconnecté ?',
        a: 'Toi, après 7 jours. Un chatteur après 12 h sans activité. Une créatrice après 30 jours, ou 7 jours sans ouvrir l’appli.',
      },
      {
        q: 'Un membre part ?',
        a: 'Sur sa fiche, le statut « Parti » coupe tout de suite.',
      },
    ],
  },
  manager: {
    lead: 'Tu fais tourner l’équipe : le planning, les rapports, la qualité des réponses.',
    day: [
      { title: 'Le matin', text: 'Dashboard : urgences et objectif du jour, puis le planning.' },
      { title: 'Pendant les shifts', text: 'Suivi : les conversations où un humain est demandé.' },
      { title: 'Le soir', text: 'Valider les rapports de fin de shift, en lot.' },
    ],
    guides: [
      {
        id: 'construire-le-planning',
        icon: 'planning',
        title: 'Construire le planning',
        summary: 'Qui tient quel compte, et quand',
        minutes: '10 min',
        essential: true,
        why: 'Un shift dit qui répond à quels fans. Sans shift, personne ne prend les conversations à la main.',
        steps: [
          {
            do: 'Équipe › Planning, « Ajouter un shift » sur le jour voulu.',
            see: 'le panneau du nouveau shift.',
          },
          {
            do: 'Choisis le membre, les heures et le compte (un shift, un compte).',
            see: 'le bloc du shift, à la couleur du membre.',
          },
          {
            do: 'Enregistre.',
            see: 'le shift dans l’Aujourd’hui et le Planning du chatteur.',
          },
        ],
        stuck: [
          'Un membre en congé, malade, en déplacement, suspendu ou parti : ses shifts restent au planning, à pourvoir. Remets-le « Actif » dans Équipe › Membres.',
        ],
      },
      {
        id: 'valider-les-rapports-de-fin-de-shift',
        icon: 'eye',
        title: 'Valider les rapports de fin de shift',
        summary: 'La paie en dépend',
        minutes: '5 min',
        essential: true,
        why: 'Un rapport validé fait entrer le shift dans la paie et la commission du chatteur. La plupart se valident seuls.',
        steps: [
          {
            do: 'Équipe › Rapports.',
            see: 'les rapports qui t’attendent.',
          },
          {
            do: '« Tout valider (N) » en haut, ou un par un.',
            see: '« Validé » sur chacun.',
          },
          {
            do: 'Un rapport faux : « Renvoyer » avec un mot.',
            see: 'le chatteur le reçoit dans son Aujourd’hui.',
          },
        ],
        rule: [
          'Un rapport qui colle aux ventes lues sur Reveal se valide seul en 5 minutes.',
          'Un écart : le chatteur a 48 h pour corriger ou expliquer ; le rapport ne se coche pas avant.',
        ],
        stuck: ['Rapport refusé : les règles de paie du compte manquent, le propriétaire les règle.'],
      },
      {
        id: 'primes-et-malus',
        icon: 'pay',
        title: 'Primes et malus',
        summary: 'Ce que tu peux faire, ce qui revient au propriétaire',
        minutes: '2 min',
        why: 'Chaque ajout se voit sur le relevé du membre, avec son motif.',
        steps: [
          {
            do: 'Paie › Primes et malus, « Malus ».',
            see: 'le formulaire, motif obligatoire.',
          },
          {
            do: 'Écris le motif et le montant.',
            see: 'la ligne sur la quinzaine en cours.',
          },
        ],
        rule: ['Malus : toi. Prime et ajustement : le propriétaire seul.'],
      },
      {
        id: 'corriger-l-ia',
        icon: 'train',
        title: 'Corriger l’IA',
        summary: 'Entraîner › Playground',
        minutes: '10 min',
        why: 'Chaque correction apprend à l’IA. Tu notes et tu corriges ; le propriétaire décide ce qui devient un exemple de voix.',
        steps: [
          {
            do: 'Entraîner, choisis la créatrice et une situation.',
            see: 'la réponse proposée par l’IA.',
          },
          {
            do: 'Note-la, puis réécris ce qui sonne faux.',
            see: 'ta version à côté de la sienne.',
          },
          {
            do: 'Envoie la correction.',
            see: '« Corrections » compte une de plus.',
          },
        ],
      },
      {
        id: 'une-alerte',
        icon: 'bell',
        title: 'Une alerte',
        summary: 'Reprendre une conversation',
        minutes: '2 min',
        why: 'L’IA s’arrête d’elle-même sur un fan sensible et attend un humain.',
        steps: [
          {
            do: 'Ouvre l’alerte depuis Telegram ou Suivi › Alertes.',
            see: 'la conversation et la raison.',
          },
          {
            do: '« Reprendre la main », ou confie-la à un chatteur en shift.',
            see: '« Pris en main par … ».',
          },
        ],
        never: ['Doute sur l’âge : rendre la main ne suffit pas, vois « Un fan à l’âge douteux ».'],
      },
      {
        id: 'une-annonce-a-l-equipe',
        icon: 'tracking',
        title: 'Une annonce à l’équipe',
        summary: 'Un mot lu dans leur Aujourd’hui',
        minutes: '1 min',
        steps: [
          {
            do: 'Équipe › Annonces, « Nouvelle annonce ».',
            see: 'le champ et le choix des destinataires.',
          },
          {
            do: 'Toute l’équipe, ou les membres d’une créatrice.',
            see: 'l’annonce en haut de leur Aujourd’hui jusqu’à ce qu’ils la lisent.',
          },
        ],
      },
      {
        id: 'un-fan-a-l-age-douteux',
        icon: 'bell',
        title: 'Un fan à l’âge douteux',
        summary: 'L’IA se tait jusqu’à ce qu’un humain tranche',
        minutes: '2 min',
        why: 'Au moindre doute sur son âge, l’IA n’écrit plus rien à ce fan. Rendre la main ne lève pas ce doute : seule une confirmation écrite le fait.',
        steps: [
          {
            do: 'Suivi, la fiche du fan, « Limites du fan ».',
            see: '« Âge contesté », en ambre.',
          },
          {
            do: 'Si tu as une preuve, « Confirmer son âge », puis écris pourquoi.',
            see: 'la raison demandée (« Pièce d’identité vue, appel vidéo… »), puis « Âge confirmé ».',
          },
        ],
        never: ['Confirmer sans preuve. Dans le doute, on ne lui écrit plus.'],
      },
      {
        id: 'ton-code-a-deux-facteurs',
        icon: 'shield',
        title: 'Ton code à deux facteurs',
        summary: 'Codes de secours, téléphone perdu',
        minutes: '3 min',
        why: 'Sans lui, l’app ne s’ouvre pas. Tes codes de secours sont ta seule porte si tu perds ton téléphone.',
        steps: [
          {
            do: 'Moi › Sécurité : active la double authentification avec ton application d’authentification.',
            see: 'tes codes de secours.',
          },
          {
            do: 'Recopie tes codes de secours à la main, ou télécharge-les, et range-les hors de ton téléphone.',
            see: 'chaque code ne sert qu’une fois.',
          },
        ],
        stuck: [
          'Téléphone perdu : à la connexion, tape un code de secours dans « Code à 6 chiffres ou de secours », puis refais ta double authentification dans Moi › Sécurité.',
          'Plus de code de secours : préviens le propriétaire.',
        ],
      },
    ],
    faq: [
      {
        q: 'Je vois les ventes et les parts ?',
        a: 'Oui, tout au Dashboard. Seul le contrat de la créatrice t’est caché.',
      },
      {
        q: 'Je peux ranger une correction comme exemple de voix ?',
        a: 'Non, c’est le propriétaire. Tes corrections lui arrivent.',
      },
      {
        q: 'Mon chatteur ne voit pas son shift ?',
        a: 'Il faut un compte de plateforme sur le shift, et son statut « Actif ».',
      },
      {
        q: 'Pourquoi l’IA n’a pas répondu à ce fan ?',
        a: 'Une coupure : doute sur l’âge, fan en difficulté, « Ne plus lui écrire », ventes gelées, un humain tient la conversation, ou le mode Arrêt. Le Suivi dit laquelle.',
      },
      {
        q: 'Je donne une prime ?',
        a: 'Non : tu peux poser un malus, avec un motif. Les primes reviennent au propriétaire.',
      },
      {
        q: 'Je vois où un chatteur est payé ?',
        a: 'Non. Ses coordonnées de paiement ne sont vues que par lui et le propriétaire.',
      },
      {
        q: 'Je réponds à une demande sur mesure ?',
        a: 'Non : tu la lis dans « Commandes en cours », le propriétaire répond.',
      },
    ],
  },
  chatter: {
    lead: 'Tu tiens les conversations ; le copilote te prépare chaque réponse.',
    day: [
      { title: 'Prise de poste', text: 'Aujourd’hui te dit où aller et jusqu’à quand.' },
      {
        title: 'Pendant le shift',
        text: 'Reveal ouvert, le copilote à côté : lire le geste, copier, envoyer.',
      },
      { title: 'Fin de shift', text: '« Faire mon rapport ». Ta commission suit.' },
    ],
    guides: [
      {
        id: 'ta-premiere-journee',
        icon: 'phone',
        title: 'Ta première journée',
        summary: 'Les six gestes à faire une fois',
        minutes: '20 min',
        essential: true,
        why: 'Une fois ces gestes faits, tu ne t’en occupes plus.',
        steps: [
          {
            do: 'Ouvre ton lien d’invitation, choisis ton mot de passe, active le code à deux facteurs.',
            see: 'Aujourd’hui, avec ton prochain shift.',
          },
          {
            do: 'Installe Impera sur ton téléphone (Moi › Aide).',
            see: 'l’icône Impera sur ton écran d’accueil.',
          },
          {
            do: 'Installe l’extension sur ton PC, dans Chrome ou Edge (Moi › Aide › Installer l’extension).',
            see: 'l’icône Impera épinglée en haut à droite.',
          },
          {
            do: '« Relier l’extension à ce CRM », puis l’icône Impera, « Relier ».',
            see: 'ton nom dans l’extension.',
          },
          {
            do: 'Moi › Sécurité, « Relier l’extension », « Copier » ; colle le code dans la carte « Copilote » de l’extension, « Relier ».',
            see: 'tes gestes comptent désormais à ton nom.',
          },
          {
            do: 'Connecte-toi à Reveal avec ton propre compte.',
            see: 'la messagerie de Reveal.',
          },
        ],
        stuck: [
          'Le lien a expiré : demande-en un nouveau à ton manager.',
          'L’extension ne montre pas ton nom : refais « Relier ».',
        ],
      },
      {
        id: 'le-copilote',
        icon: 'train',
        title: 'Le copilote',
        summary: 'Lire le panneau en 30 secondes',
        minutes: '30 s',
        essential: true,
        why: 'Le copilote suit la conversation que tu regardes dans Reveal. Il te dit quoi faire, et prépare la réponse bulle par bulle.',
        chips: [
          {
            tone: 'go',
            text: 'Bon moment : propose l’étape et le prix choisis',
          },
          {
            tone: 'warn',
            text: 'Ne rien vendre : la ligne dit ce qui manque',
          },
          {
            tone: 'danger',
            text: 'Âge contesté, Ne plus lui écrire, Ventes gelées',
          },
        ],
        steps: [
          {
            do: 'Dans Reveal, ouvre une conversation, puis l’icône Impera, « Ouvrir le copilote ».',
            see: 'en haut le fan et ses repères ; dessous le geste conseillé et le brouillon.',
          },
          {
            do: 'Lis le geste, en gras au-dessus du brouillon, et la ligne en dessous.',
            see: 'la couleur du moment : vert, ambre ou rouge.',
          },
          {
            do: '<kbd>A</kbd> « Copier pour Reveal » : colle dans Reveal, envoie, puis copie la bulle suivante.',
            see: 'le panneau dit quelle bulle est copiée et laquelle vient ensuite.',
          },
          {
            do: '<kbd>E</kbd> pour retoucher, <kbd>R</kbd> pour refuser avec une raison.',
            see: 'ta raison enregistrée ; elle apprend à l’IA.',
          },
        ],
        rule: [
          'Ce que tu envoies dans les 15 minutes compte comme le brouillon : tel quel, il est validé ; changé, il est corrigé avec ton texte ; rien d’envoyé, il expire.',
          'En vert, on propose l’étape et le prix choisis par Impera, jamais un autre.',
        ],
        never: ['« Âge contesté » ou « Ne plus lui écrire » : tu n’écris rien et tu préviens ton manager.'],
        stuck: [
          '« Fan fragile » ou « Ventes gelées » : tu peux répondre, sans rien vendre, en relisant le brouillon.',
          'Pas de brouillon du tout : les brouillons sont éteints pour cette créatrice, le propriétaire les allume dans Créatrices › IA.',
        ],
      },
      {
        id: 'lire-la-fiche-du-fan',
        icon: 'me',
        title: 'Lire la fiche du fan',
        summary: 'Ce qu’elle sait de lui, en cinq onglets',
        minutes: '1 min',
        why: 'La fiche te dit à qui tu parles sans remonter la conversation. Elle est sous le brouillon, dans le copilote.',
        chips: [
          {
            tone: 'ok',
            text: 'Il l’a dit',
          },
          {
            tone: 'warn',
            text: '« deviné » : l’IA l’a déduit',
          },
          {
            tone: 'warn',
            text: 'Point ambre : à vérifier',
          },
        ],
        steps: [
          {
            do: 'Sous le brouillon, cinq onglets : L’essentiel, Lui, Elle vue par lui, Intime, Vente.',
            see: 'chaque conversation s’ouvre sur « L’essentiel » : prénom, âge, ville, ce qui l’excite.',
          },
          {
            do: 'Change d’onglet d’un clic, ou avec les touches <kbd>1</kbd> à <kbd>5</kbd>.',
            see: 'le chiffre de chaque onglet : ce qu’on sait déjà.',
          },
          {
            do: '« Il ne veut pas », en ambre, reste épinglé au-dessus de chaque onglet.',
            see: 'toujours lisible, même quand « Intime » est masqué.',
          },
          {
            do: 'Un point ambre sur un onglet : « À vérifier ».',
            see: 'ce que l’agent a lu, à côté de ce qui est noté. Relis avant de t’y fier.',
          },
        ],
        rule: [
          'Dès la mise en ligne, la fiche lit toute la conversation, du plus ancien au plus récent, puis la relit chaque lundi.',
          'Âge contesté : « Intime » reste masqué.',
        ],
      },
      {
        id: 'ton-rapport-de-fin-de-shift',
        icon: 'clapper',
        title: 'Ton rapport de fin de shift',
        summary: 'Ce qui fait entrer ton shift dans la paie',
        minutes: '3 min',
        essential: true,
        steps: [
          {
            do: 'Aujourd’hui : « Faire mon rapport » s’ouvre 30 minutes avant la fin du shift.',
            see: 'le formulaire du rapport.',
          },
          {
            do: 'Tape le brut de tes ventes, ajoute ce qui manque, envoie.',
            see: '« Rapport envoyé ».',
          },
          {
            do: 'Attends la validation.',
            see: '« Validé » : tout seul en 5 minutes s’il colle aux ventes lues sur Reveal, sinon quand l’agence l’a relu.',
          },
        ],
        rule: ['Un écart avec les ventes lues : tu as 48 h pour corriger ou expliquer.'],
        stuck: ['Rapport renvoyé : lis le mot de ton manager, corrige, renvoie.'],
      },
      {
        id: 'echanger-un-shift',
        icon: 'planning',
        title: 'Échanger un shift',
        summary: 'Sans passer par ton manager',
        minutes: '2 min',
        why: 'Un empêchement ? Propose ton shift à un collègue.',
        steps: [
          {
            do: 'Planning, ton shift, « Échange ».',
            see: 'les membres libres à ces heures.',
          },
          {
            do: 'Choisis quelqu’un, ou « Quelqu’un » pour tous, puis « Envoyer la demande ».',
            see: 'la demande en attente de sa réponse.',
          },
          {
            do: 'L’autre accepte.',
            see: '« C’est fait : vous avez échangé vos shifts ».',
          },
        ],
      },
      {
        id: 'demander-un-conge',
        icon: 'planning',
        title: 'Demander un congé',
        summary: 'Des jours entiers, une demande à l’agence',
        minutes: '1 min',
        steps: [
          {
            do: 'Planning, « Mes congés », « Demander un congé ».',
            see: 'le formulaire : premier et dernier jour.',
          },
          {
            do: 'Tes jours (31 au plus, à partir d’aujourd’hui), un mot pour l’agence si tu veux, « Envoyer la demande ».',
            see: 'ta demande dans « Mes congés ».',
          },
        ],
        stuck: ['« Tu as un shift ces jours-là » : propose-le d’abord en échange.'],
      },
      {
        id: 'ta-commission-et-tes-factures',
        icon: 'pay',
        title: 'Ta commission et tes factures',
        summary: 'Accepter ou contester avant le délai',
        minutes: '2 min',
        why: 'L’agence émet tes factures en ton nom. Tu les vérifies.',
        steps: [
          {
            do: 'Commissions : ta quinzaine, de tes ventes à ce que tu touches.',
            see: 'le montant, calculé dès qu’un rapport est validé, ou dès que la vente est lue sur Reveal pour un compte payé ainsi.',
          },
          {
            do: 'Commissions › Factures : accepte ou conteste chaque facture.',
            see: '« Acceptée » ou « Contestée ».',
          },
        ],
        rule: [
          'Sans réponse avant le délai, la facture est acceptée tacitement.',
          'Moi › Dossier doit être complet (identité, contrat, mandat) pour que tes factures partent.',
        ],
      },
      {
        id: 'reprendre-la-main-sur-un-fan',
        icon: 'tracking',
        title: 'Reprendre la main sur un fan',
        summary: 'Quand l’agent lui écrit seul',
        minutes: '1 min',
        why: 'Sur un compte en Automatique, l’agent répond seul. Tu peux le relayer à tout moment.',
        steps: [
          {
            do: 'Suivi, la conversation, « Reprendre la main ».',
            see: 'l’agent arrête de lui écrire ; tu réponds dans Reveal.',
          },
          {
            do: 'Fini : écris une note si besoin, puis « Rendre la main à l’agent ».',
            see: '« Rendre la main (avec la note) » si tu en as écrit une ; l’agent la lit et reprend.',
          },
        ],
        never: [
          'Rendre la main ne lève pas un doute sur l’âge ni un fan en difficulté : préviens ton responsable.',
        ],
      },
      {
        id: 'ton-rang-et-ta-progression',
        icon: 'creators',
        title: 'Ton rang et ta progression',
        summary: 'Pour le plaisir, sans effet sur la paie',
        minutes: '1 min',
        steps: [
          {
            do: 'Aujourd’hui, « Ma progression » : ton rang, la barre vers le suivant, ta série de shifts, « À ta portée ».',
            see: 'toute la carte mène à Moi › Trophées.',
          },
          {
            do: '« Défi du shift » : fais mieux que ton jour habituel.',
            see: 'contre toi-même, jamais contre un collègue.',
          },
          {
            do: 'Commissions, « Mon rang » et « D’où vient mon argent ».',
            see: 'ton net de la quinzaine par type de vente.',
          },
        ],
        rule: [
          'Ton rang suit ton net cumulé depuis ton arrivée. Il est honorifique : ni ton taux ni ta paie n’en dépendent.',
          '« Pas encore comptée par type » ne veut pas dire zéro.',
        ],
      },
      {
        id: 'tes-shifts-dans-ton-calendrier',
        icon: 'planning',
        title: 'Tes shifts dans ton calendrier',
        summary: 'Ceux du téléphone, à jour tout seuls',
        minutes: '1 min',
        steps: [
          {
            do: 'Planning, « Dans mon téléphone », « Copier le lien ».',
            see: '« Copié ».',
          },
          {
            do: 'Ajoute-le comme calendrier par lien dans ton appli de calendrier.',
            see: 'tes shifts dans ton calendrier, mis à jour seuls.',
          },
        ],
      },
      {
        id: 'ton-code-a-deux-facteurs',
        icon: 'shield',
        title: 'Ton code à deux facteurs',
        summary: 'Codes de secours, téléphone perdu',
        minutes: '3 min',
        why: 'Sans lui, l’app ne s’ouvre pas. Tes codes de secours sont ta seule porte si tu perds ton téléphone.',
        steps: [
          {
            do: 'Moi › Sécurité : active la double authentification avec ton application d’authentification.',
            see: 'tes codes de secours.',
          },
          {
            do: 'Recopie tes codes de secours à la main, ou télécharge-les, et range-les hors de ton téléphone.',
            see: 'chaque code ne sert qu’une fois.',
          },
        ],
        stuck: [
          'Téléphone perdu : à la connexion, tape un code de secours dans « Code à 6 chiffres ou de secours », puis refais ta double authentification dans Moi › Sécurité.',
          'Plus de code de secours : préviens le propriétaire.',
        ],
      },
    ],
    faq: [
      {
        q: 'Pourquoi je ne vois pas ma commission dans l’extension ?',
        a: 'Exprès : pendant le shift, tu regardes le fan, pas l’argent. Elle est sur ton accueil.',
      },
      {
        q: 'L’IA envoie-t-elle à ma place ?',
        a: 'En Copilote, jamais : c’est toi qui colles et envoies.',
      },
      {
        q: 'Mon rang me fait gagner plus ?',
        a: 'Non, il est honorifique. Ta paie suit ton relevé et les paliers de Commissions.',
      },
      {
        q: 'Pourquoi ma barre a reculé ?',
        a: 'Une vente remboursée ou un rapport corrigé a baissé ton net. Regagné, il revient.',
      },
      {
        q: 'Les autres voient mes chiffres ?',
        a: 'Non, et il n’y a aucun classement. Le propriétaire et le manager voient ta fiche.',
      },
      {
        q: 'Pourquoi le copilote dit « Ne rien vendre » ?',
        a: 'Le code attend : la ligne en dessous dit ce qui manque. Tu ne changes ni le moment ni le prix.',
      },
      {
        q: 'Je conteste une facture, et après ?',
        a: 'Le propriétaire tranche. Une nouvelle facture remplace l’ancienne.',
      },
      {
        q: 'Pourquoi mon versement est bloqué ?',
        a: 'Une pièce de ton dossier manque ou n’est pas encore vérifiée. C’est écrit sur ton relevé ; complète Moi › Dossier.',
      },
      {
        q: 'Qui voit où je suis payé ?',
        a: 'Toi et le propriétaire seulement, jamais un manager. Tes coordonnées sont chiffrées.',
      },
      {
        q: 'Pourquoi je suis déconnecté ?',
        a: 'Après 12 h sans activité. Reconnecte-toi avec ton code à deux facteurs.',
      },
    ],
  },
  creator: {
    lead: 'Ton espace se lit en quelques secondes : ce qu’on te demande aujourd’hui, et ce que tu envoies.',
    day: [
      { title: 'Ouvre Aujourd’hui', text: 'Une seule chose en gros : ce qu’il reste à faire.' },
      { title: 'Dépose ton contenu', text: 'Contenu, « Déposer » : l’agence s’occupe du reste.' },
      { title: 'C’est tout', text: 'Le reste, l’agence s’en occupe.' },
    ],
    guides: [
      {
        id: 'impera-sur-ton-telephone',
        icon: 'phone',
        title: 'Impera sur ton téléphone',
        summary: 'Une minute, une seule fois',
        minutes: '1 min',
        essential: true,
        steps: [
          {
            do: 'iPhone : Safari, bouton Partager, « Sur l’écran d’accueil ». Android : Chrome, menu ⋮, « Installer ».',
            see: 'l’icône Impera sur ton écran d’accueil.',
          },
          {
            do: 'Ouvre Impera depuis l’icône, Moi › Préférences, « Régler mes notifications », « Activer les notifications ».',
            see: 'une notification de test.',
          },
        ],
      },
      {
        id: 'deposer-ton-contenu',
        icon: 'content',
        title: 'Déposer ton contenu',
        summary: 'Ce qu’on te demande de tourner',
        minutes: '2 min',
        essential: true,
        steps: [
          {
            do: 'Contenu, « À tourner » : chaque demande avec son emoji et son jour.',
            see: '« Pour aujourd’hui », « Pour demain ».',
          },
          {
            do: 'Sur la demande, « Déposer » (ou « Je ne peux pas »).',
            see: 'la feuille d’envoi.',
          },
          {
            do: '« Choisir dans ma galerie », puis « Envoyer ». Garde l’appli ouverte jusqu’à la fin.',
            see: 'la carte dans « En route », une barre par fichier.',
          },
          {
            do: 'Attends le retour de l’agence.',
            see: '« En préparation », puis « Bien reçu » ; le dépôt passe « Reçu » puis « Prêt ».',
          },
        ],
        rule: [
          'Sans demande, les tuiles « Envoyer autre chose ».',
          'L’agence relit pour toi la description de chaque média : tu n’as rien à écrire.',
        ],
        stuck: [
          '« L’envoi s’est arrêté » : « Réessayer », ou « Reprendre l’envoi » en rechoisissant les mêmes fichiers.',
        ],
      },
      {
        id: 'tes-liens',
        icon: 'traffic',
        title: 'Tes liens',
        summary: 'À coller dans tes bios',
        minutes: '30 s',
        steps: [
          {
            do: 'Moi › Mes liens, « Copier » à côté du lien.',
            see: '« Copié ».',
          },
          {
            do: 'Colle-le où il est indiqué.',
            see: 'le bon lien au bon endroit.',
          },
        ],
      },
      {
        id: 'ta-persona',
        icon: 'me',
        title: 'Ta persona',
        summary: 'Ce que l’agence sait de toi',
        minutes: '2 min',
        why: 'C’est la fiche dont l’agence se sert pour parler comme toi. Si quelque chose est faux, dis-le.',
        steps: [
          {
            do: 'Moi › Persona : ta fiche, panneau par panneau. Ouvre-en un pour le lire.',
            see: 'ce qui est écrit sur toi.',
          },
          {
            do: 'Une erreur ? « Proposer une correction », dans le panneau.',
            see: 'ta correction, envoyée à l’agence.',
          },
        ],
        rule: ['« Ta fiche est en préparation » : l’agence la remplit avec toi.'],
      },
    ],
    faq: [
      {
        q: 'Je dois lire tout ça ?',
        a: 'Non. Si un écran n’est pas clair sans guide, dis-le : c’est l’écran qu’on corrigera.',
      },
      {
        q: 'Quelle taille au maximum ?',
        a: 'Une vidéo 10 Go ; une photo ou un vocal 30 Mo. Au-delà, la carte te le dit avant l’envoi.',
      },
      {
        q: 'Je me suis trompée, je peux annuler ?',
        a: 'Oui, « Retirer » sur la carte, tant que l’agence ne l’a pas programmé. Ensuite, préviens l’agence.',
      },
      {
        q: 'Pourquoi « Déjà dans ta médiathèque » ?',
        a: 'Ce fichier exact est déjà chez l’agence : rien à refaire, il n’est pas compté deux fois.',
      },
      {
        q: 'Pourquoi je suis déconnectée ?',
        a: 'Après 30 jours, ou 7 jours sans ouvrir l’appli. Reconnecte-toi, c’est tout.',
      },
    ],
  },
};
