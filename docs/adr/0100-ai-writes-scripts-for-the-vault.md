# 0100. Une IA écrit les scripts à partir des médias du coffre, le code tient la vente

Statut : accepted (« ok 0100 » de Charles le 12/11/2026, 23 h 34, fil « Synchroniser le Vault Reveal », après son choix du 12/11 à 23 h 34 : relecture par défaut, automatique réglable par créatrice ; relu par Agent)
Date : 2026-11-12
Précise : l'ADR 0099 (scripts composés dans le CRM et créés dans Reveal, ordre de Reveal gardé), l'ADR 0083 (description validée avant usage), l'ADR 0009 (règles métier dans le code), l'ADR 0010 (persona = donnée versionnée) et l'ADR 0021 (le bot ne dit jamais qu'il est une IA) et l'ADR 0098 (déroulé de script par fan). Ne remplace rien.

## Contexte

L'ADR 0099 permet de composer un script dans le CRM avec des médias du coffre et de le créer dans Reveal. Le 12/11/2026 à 23 h 27, Charles va plus loin : il veut « une IA […] douée de copywriting avec la voix de la modèle pour faire les scripts qui sont liés aux médias qu'on vend », qui les crée ensuite « directement dans Reveal pour que ça profite aussi aux chatters ».

Écrire un script, c'est deux métiers : des textes (teasing, étapes, ponts) qui donnent envie, dans la voix de la créatrice ; et des règles de vente (prix en escalier, ordre des médias, moment Jour ou Nuit, rien d'annoncé qui ne part pas). Le premier va bien à un modèle de langage, le second appartient au code.

## Décision

1. **Un rôle LLM nouveau, `script_writer`.** Ce n'est pas le rôle `voice` : `voice` écrit une bulle de conversation au présent pour un fan donné, avec ses gardes, son budget et son délai ; un script est un texte long, hors conversation, pour n'importe quel fan. Il lit la même persona, côté privé compris (style, limites, façon de dire non, ce qu'elle n'écrirait jamais). Pour un ensemble de médias synchronisés dont chaque description est validée (ADR 0083), il propose les textes d'une séquence selon la méthode de script de l'agence : teasing offert, étapes payantes, ponts offerts. Il écrit dans la voix de la persona active, lue dans sa version courante (ADR 0010). Son prompt est une donnée versionnée de `packages/llm` ; sa sortie est validée par un schéma Zod ; son appel est journalisé dans `llm_calls` et compte dans le budget du jour.

2. **Le code tient la vente, jamais le prompt.**
   - L'ordre des médias suit l'ordre de Reveal (ADR 0099 § 3) ou celui choisi par l'agence ; le moment Jour ou Nuit vient du dossier ; le prix vient de la grille de l'agence.
   - Le code refuse une séquence dont une étape coûte plus du double de la précédente ou dépasse 40 $ (P6-01), un texte qui annonce un média absent de l'étape, et un média sans description validée.
   - Le texte ne décrit un média qu'à partir de sa description validée, jamais de son imagination, et ne contient aucun prix.
   - Chaque texte passe, avant d'être enregistré, les gardes dures de la voix : `ai_disclosure` (ADR 0021), sortie de plateforme, rencontre, remise, promesse de relation. Une garde qui bloque empêche la création du script.
   - Le texte parle au présent (« je viens de… »), jamais d'un contenu préparé ou enregistré à l'avance : le fan ne doit pas voir que le script est prêt.
   - La structure suit l'ADR 0098 : étapes offertes, payantes et ponts, avec des clés de segment stables que le moteur de déroulé suit.
   - Chaque script porte une description de son déroulé (thème, ce qui chauffe, Jour ou Nuit) : c'est sur elle que le cerveau choisit le script adapté au fan (ADR 0098 § 6). Un script sans cette description n'est pas créé.
   - Le rôle a ses évals (`evals/`), sur une persona fictive, sans aucune donnée réelle dans le dépôt.

3. **Relecture humaine par défaut, automatique par choix.** Par défaut, un membre de l'agence relit le script, le retouche au besoin et choisit « Créer dans Reveal ». Un interrupteur par créatrice, que seul le propriétaire bascule, permet la création sans relecture. Dans les deux cas, la création passe par la garde d'écriture (ADR 0018 § 3, ADR 0099 § 6), et le script créé est relu par la synchronisation suivante : les chatteurs le voient dans Reveal comme tout autre script.

4. **Mesure avant confiance.** Chaque script relu garde la trace de ce que l'humain a changé (texte retouché, refusé). Cette mesure sert à décider quand passer une créatrice en automatique ; elle est montrée au propriétaire à côté de l'interrupteur.

## Conséquences

Positives :
- Un coffre décrit devient des scripts vendables sans les écrire à la main, disponibles pour l'agent et pour les chatteurs.
- Les règles de vente ne dépendent pas de la qualité du modèle.

Négatives :
- Un appel d'IA de plus par script, dans le budget du jour.
- Un script créé dans Reveal n'est ni modifié ni supprimé depuis le CRM (ADR 0099 § 6) : une erreur de texte se corrige à la main dans Reveal.

À surveiller :
- La voix sur des textes longs : évals dédiées (`evals/`) avant d'ouvrir l'automatique.
- La grille de prix de l'agence (P6-01) doit exister avant la première création réelle.

## Alternatives rejetées

- **Laisser l'IA fixer prix et ordre.** Contraire à la règle 3 du dépôt : la vente vit dans le code.
- **Automatique pour tous dès le départ.** Rien ne se supprime depuis le CRM ; sans mesure, on ne sait pas si la voix tient.
- **Relecture obligatoire pour toujours.** Ferme la porte au gain de temps que Charles cherche une fois la qualité prouvée.
