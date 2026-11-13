# 0079. La fiche persona reprend la fiche Desirali, onglet par onglet et question par question

Statut : accepted (Charles, 06/11/2026 20h13, « ok 0079 », fil Agent)
Date : 2026-11-06
Précise : l'ADR 0010 (la persona est une donnée versionnée, hors dépôt pour les vraies créatrices).
Amendée par : l'ADR 0090 (deux questions de plus dans « Conversation », 61 au total ; les répliques aux objections dans « Réglages de l'agent »).
Remplace : les blocs P5-01 de la fiche (`lifestyle`, `tastes`, `intimate`, `writing_style`, `sample_replies`), `additional_info` et les listes fermées des détails, pour toute nouvelle version.

## Contexte

La fiche persona d'Impera suit l'onglet créatrice d'OnlyChat, plus les blocs P5-01 ajoutés en octobre. Le 06/11, le fil persona a rempli la fiche de Messa au format de Desirali : 7 sections et 60 questions. Comparée à notre schéma, elle donne 15 champs qui entrent sans perte, 28 abîmés et 17 sans place. Les captures de Charles du 06/11 (21h11) lèvent les deux doutes : la question « Pratiques / Kinks » existe dans Intimité, et ce que Charles appelle « Sujets à éviter » est le champ « Zones interdites », seul dans son panneau en bas de la fiche. La fiche compte 59 questions.

Charles a d'abord répondu « ok persona v2 » à la proposition d'agrandir notre schéma. Puis il a précisé (06/11, 20h01, fil persona) : « faire exactement pareil […] d'enlever ce qu'on avait fait nous et […] de copier mot pour mot onglet par onglet leur fiche persona ».

La structure exacte, sans contenu, est relevée dans `/mnt/project-files/persona/structure-desirali-exacte.md` (hors dépôt).

## Décision

1. **La fiche, c'est Desirali.** Les questions de la persona sont les 59 de Desirali, dans leurs 7 sections, dans le même ordre, avec les mêmes libellés au mot près et la même disposition (pleine largeur, demi, tiers). Les sections :
   1. Identité et informations de base
   2. Mode de vie
   3. Préférences
   4. Style de conversation
   5. Relations
   6. Intimité
   7. un dernier panneau, sans autre question que « Zones interdites »

   Les clés du fichier sont celles de Desirali (`physical_description`, `shoe_size`, `birth_date`…), rangées par section. Le fichier passe à `meta.schema: 2`.

2. **Du texte libre, comme chez eux.** Toutes les réponses sont du texte libre, sauf six :
   - la date de naissance ;
   - la taille en mètres ;
   - le poids ;
   - le nombre de partenaires (entier, facultatif) ;
   - le fuseau horaire ;
   - les langues parlées.

   Aucune question n'est obligatoire, sauf trois : le **Surnom**, c'est-à-dire le nom sous lequel l'agent écrit ; la **Date de naissance**, pour l'âge, avec au moins 18 ans ; et au moins une **langue parlée**, la langue des réponses.

   Nos listes fermées disparaissent de la fiche : origine, couleur des cheveux et des yeux en choix, tour de poitrine et bonnet, loisirs et caractère en pastilles, longueur des messages, majuscules.

3. **Ce que l'agent lit.** Le modèle reçoit toute la fiche, section par section, sous les libellés de Desirali, avec trois écarts :
   - l'âge remplace la date de naissance ;
   - le fuseau reste celui de la créatrice (`creators.timezone`), et la fiche l'affiche sans le modifier ;
   - le nombre de partenaires ne passe au modèle que s'il est rempli.

   Aucune réponse de la fiche n'est une règle : le modèle les lit, le code n'en tire rien.

4. **Les réglages de l'agent sont à part.** Ce que le code applique (CLAUDE.md, règle 3) n'est pas une question de persona chez Desirali. Ces réglages quittent la fiche pour un onglet « Réglages de l'agent », à côté d'elle et versionné avec elle :
   - les stratégies (KYC et cases à apprendre, sexualisation, lancement des scripts, suivi d'offre) ;
   - les relances et les petits rappels ;
   - les notifications et les mots-clés d'alerte ;
   - le délai de réponse ;
   - le découpage en plusieurs messages ;
   - les surnoms autorisés ;
   - les émojis interdits ;
   - les **règles strictes** des gardes : ce qu'elle ne fait, ne montre et ne dit jamais, et ce qui la dégoûte, en listes de mots.

   « Zones interdites / limites strictes » et « Zones interdites » restent des questions de la fiche, en texte libre, lues par le modèle. Les gardes, elles, ne lisent que les règles strictes, parce qu'une garde ne s'applique pas sur une phrase libre.

5. **Les versions existantes.** Une version enregistrée ne change jamais : son contenu et son empreinte restent tels quels. Le code lit les deux formats, `meta.schema` 1 et 2.
   - **Ouvrir une version au format 1.** L'écran la convertit en brouillon au format 2 selon la table de correspondance. Ce qui n'a pas de question tombe dans la plus proche, et rien ne se perd en silence : le brouillon dit ce qu'il a déplacé.
   - **Enregistrer.** Cela crée une version au format 2, qui s'active comme aujourd'hui : le propriétaire, avec son mot de passe et son code.
   - **Exemples du dépôt.** Les fichiers d'exemple (`personas/demo`, `personas/messalina` avec ses `<à remplir>`) et les évals passent au format 2.
   - **Aucune donnée** n'est réécrite en base.

6. **Ce qui suit la fiche.**
   - La fiche de la créatrice (Moi › Persona) montre les mêmes 7 sections.
   - Ses corrections se proposent par section Desirali. La liste des sections permises en base s'élargit par une migration nouvelle ; les anciennes valeurs restent valides.
   - La complétion compte les questions remplies, sur 59.
   - Les réponses types (« Réponses typiques », en texte libre) passent par les gardes dures à l'enregistrement, comme aujourd'hui les réponses types.

7. **Les libellés relevés sur captures.** Intimité compte onze questions, dont « Pratiques / Kinks » entre « Rapport à l'éjaculation » et « Fétichisme », et se termine sur « Zones interdites / limites strictes ». « Zones interdites », qui dit les sujets qu'elle refuse d'aborder et la manière de recadrer, est seul dans le dernier panneau. Il n'y a pas d'autre champ « Sujets à éviter ».

## Conséquences

- L'écran Créatrices › Persona est refait (Extension) : 7 panneaux repliables comme chez Desirali, puis l'onglet « Réglages de l'agent ». Charles valide sur captures.
- `PersonaSchema` devient l'union des formats 1 et 2 (zone Bilan pour la relecture). L'agent, la fiche de la créatrice, le playground et les évals lisent le format 2. Le format 1 n'est plus que lu, puis converti.
- Plus rien de la fiche n'est en liste fermée : une couleur d'yeux mal écrite n'est plus refusée, et le modèle la lit comme elle est écrite.
- Le statut par champ (public, intime, interne, à confirmer) reste hors de cette ADR.
