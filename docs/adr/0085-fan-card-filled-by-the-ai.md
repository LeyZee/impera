# 0085. La fiche du fan : vingt cases fermées que l'IA remplit en lisant la conversation, et que le chatteur corrige

Statut : proposed (demande de Charles du 08/11/2026, 16 h 37, fil « Bilan projet », et précision du 08/11/2026, 16 h 39 ; numéro attribué par le coordinateur)
Date : 2026-11-08
Précise : P3-02 (mémoire du fan, `fan_facts`), l'ADR 0018 § 1 (la note client de la plateforme reste lue en direct, jamais copiée) et l'ADR 0063 (la créatrice ne lit aucune note d'un fan). Ne remplace rien.

## Contexte

Le bilan du 08/11 relevait deux manques côté chatteur : le panneau copilote de l'extension et une note du fan partagée. Charles veut que l'IA tienne la note à la place des chatteurs, pour trois usages : mieux vendre (connaître sa psychologie), tenir la relation des mois, et passer un fan d'un chatteur à l'autre, ou de l'IA à un chatteur, sans que le fan sente la coupure. Il donne la liste de ce qu'il faut savoir :

prénom · surnoms qu'il aime qu'on lui donne · où il habite · âge · animal de compagnie · situation familiale · métier · jour de paie · ce qu'il aime chez la modèle · ce qu'il ne veut pas voir · jalousie ou attachement · couleur préférée · kinks et fantasmes · limites · niveau de hard · dominante ou soumise · goûts vestimentaires · événements importants · humeurs fréquentes · centres d'intérêt.

Il précise que la plupart s'apprennent en KYC, que d'autres se devinent (le jour de paie, d'après quand il achète et quand il dit attendre sa paie), et que certaines portent sur ce qu'il aime **chez elle**, pas sur lui (« goûts vestimentaires » = les tenues qu'il aime la voir porter). La collecte doit rester subtile, féminine, spontanée : jamais un questionnaire.

Ce qui existe déjà :
- `fan_facts` (module `fans`) : un fait par catégorie et clé, `declared` ou `inferred`, une confiance, le message d'où il vient, sa date, un historique (un fait plus récent remplace l'ancien, un fait déduit ne remplace jamais un fait déclaré), une purge 12 mois après le dernier contact.
- Le cerveau propose des faits (`factsProposed`) et choisit ce qui manque (`kycMissing`) parmi sept cases (`KycSlotSchema` : prénom, localisation, âge, métier, passions, envies, situation), avec la clé libre pour le reste.
- La note qu'un chatteur laisse en rendant la main devient un fait `operator_note`, en texte libre.

Ce qui manque :
1. **Les faits ne s'écrivent que quand un humain approuve un brouillon de l'IA.** Quand un chatteur écrit lui-même, rien n'est noté : c'est exactement le cas que Charles veut couvrir.
2. Les clés hors des sept cases sont libres : « couleur », « couleur_preferee » et « fav_color » font trois lignes, et aucun écran ne peut les ranger.
3. Aucun écran ne montre les faits à un chatteur, ni ne lui permet d'en corriger un.
4. Rien ne distingue « sur lui » de « ce qu'il aime chez elle ».

## Décision

1. **La fiche du fan est une liste fermée de cases, dans le code** (`FanCardFieldSchema`, `packages/contracts`). Chaque case a un code, un libellé en français écrit du point de vue du fan, une catégorie de `fan_facts`, une forme (une valeur, ou une liste) et une façon d'être apprise (§ 2). Les codes des sept cases du canevas restent les mêmes (`first_name`, `location`, `age`, `job`, `hobbies`, `desires`, `situation`), si bien que les faits déjà écrits remplissent la fiche sans reprise. Une information utile hors des cases reste possible, rangée sous « Autres » en bas de la fiche, jamais en case. Ajouter une case se fait par PR.

2. **Trois façons d'apprendre, et une seule pousse une question.**
   - **À apprendre** (KYC) : prénom, âge, ville, métier, situation, passions. Ce sont les seules que le cerveau peut nommer dans `kycMissing` et amener par une question, selon la méthode (une question au plus par message, pas à chaque message, avec une raison, en rebondissant). `KycSlotSchema` garde ses sept codes, parce que les personas enregistrées (`agent.strategies.kyc.collect`, ADR 0079) et la sortie du cerveau les lisent ; une liste `KYC_ASKABLE` de six cases (sans `desires`) s'ajoute à côté, et le code filtre `kyc.collect` avant le prompt et `kycMissing` à la sortie sur cette liste. `desires` reste accepté partout, mais n'est plus jamais demandé.
   - **À noter s'il en parle** : surnoms qu'il aime, animal, couleur préférée, événements importants, ce qu'il aime chez elle, ce qu'il ne veut pas voir d'elle, tenues qu'il aime la voir porter, fantasmes, limites. Jamais demandées hors d'un échange qui y mène déjà ; les tenues et les fantasmes peuvent se jouer pendant un échange intime (« tu me préfères en dentelle ou… »), c'est de la séduction, pas un relevé.
   - **À observer, jamais demandées** : jour de paie, humeurs fréquentes, attachement ou jalousie, niveau d'intensité qu'il cherche, s'il aime qu'elle mène ou qu'elle se laisse mener. Elles ne sont que déduites, toujours `inferred`, et la fiche les écrit comme des hypothèses.

3. **Les cases et leur libellé.**

   | Groupe | Code | Libellé (point de vue) | Forme | Apprise |
   |---|---|---|---|---|
   | Lui | `first_name` | Son prénom | une | à apprendre |
   | Lui | `pet_names` | Les petits noms qu'il aime qu'on lui donne | liste | à noter |
   | Lui | `location` | Sa ville ou sa région (jamais une adresse) | une | à apprendre |
   | Lui | `age` | Son âge | une | à apprendre |
   | Lui | `situation` | Sa situation (couple, enfants…) | une | à apprendre |
   | Lui | `job` | Son métier | une | à apprendre |
   | Lui | `hobbies` | Ses passions (sport, jeux, séries, musique…) | liste | à apprendre |
   | Lui | `pets` | Ses animaux | liste | à noter |
   | Lui | `favourite_colour` | Sa couleur préférée | une | à noter |
   | Lui | `life_events` | Ce qui se passe dans sa vie (anniversaire, vacances, rupture, examen…), daté | liste | à noter |
   | Lui | `moods` | Ses humeurs fréquentes (seul, stressé, excité…) | liste | à observer |
   | Lui | `payday` | Quand il a de l'argent | une | à observer |
   | Lui | `attachment` | Son attachement à elle (jalousie, « tu me manques »…) | une | à observer |
   | Ce qu'il aime chez elle | `likes_about_her` | Ce qu'il aime chez elle (physique, caractère, attitude) | liste | à noter |
   | Ce qu'il aime chez elle | `dislikes_about_her` | Ce qu'il ne veut pas voir d'elle | liste | à noter |
   | Ce qu'il aime chez elle | `outfits` | Les tenues qu'il aime la voir porter (lingerie, cosplay, nue…) | liste | à noter |
   | Intime | `desires` | Ses fantasmes | liste | à noter |
   | Intime | `limits` | Ce qu'il ne veut pas (« je n'aime pas… ») | liste | à noter |
   | Intime | `intensity` | L'intensité qu'il cherche : doux, coquin, très explicite | une | à observer |
   | Intime | `lead` | Il aime qu'elle mène, qu'elle se laisse mener, ou les deux | une | à observer |

   `intensity` et `lead` ont des valeurs fermées ; les autres sont du texte court (300 caractères au plus, comme aujourd'hui).

4. **Ce que la plateforme sait déjà et que l'IA n'écrit jamais.** Ce qu'il a dépensé, son dernier achat, le prix le plus haut qu'il a payé, les scripts déjà envoyés et l'étape où il s'est arrêté : Reveal les tient déjà. La fiche les lit chez la plateforme, en tête, par les lectures du port connecteur (`getFanPpvStats`, `getScriptHistory`, `getFanProfile`, ADR 0018 lot B, après la capture), sans les recopier dans une case ni les faire deviner. S'y ajoutent ce qu'Impera sait seul : depuis quand il parle, les heures où il écrit dans le fuseau de la créatrice, sa note de désir et ses limites de sécurité (`fans.flags`). Aucun modèle ne devine un de ces chiffres.

5. **Chaque case dit d'où elle vient et quand.** Trois sources : **dit par lui** (`declared`), **deviné** (`inferred`, avec la phrase du fan qui le justifie, lue depuis `source_message_id`) et **noté par un chatteur** (`noted`, nouveau, avec son auteur). La fiche affiche la source et l'âge de la valeur (« dit par lui, il y a 3 jours »). L'historique reste : une valeur corrigée garde l'ancienne derrière elle.

6. **L'humain gagne, et l'IA le signale au lieu d'écraser.** Ordre de force : noté par un chatteur, puis dit par lui, puis deviné. Une valeur plus faible ne remplace jamais une plus forte ; quand l'IA lit une valeur qui contredit celle d'un chatteur, elle la pose sous la case, en ambre, « à vérifier », et le chatteur garde l'une ou l'autre en un geste. Le chatteur corrige, ajoute ou efface une case en un geste ; effacer écrit une ligne de retrait, rien ne disparaît de l'historique avant la purge.

7. **L'IA lit chaque message du fan, quel que soit qui lui répond.** Un job rejouable (`fans.read_card`) lit les nouveaux messages du fan d'une conversation, avec la fiche active, et propose des faits. Il part quand le fan se tait cinq minutes ou après dix messages, au plus une fois toutes les dix minutes par conversation, avec le rôle `brain` sur un prompt versionné à part (`brain/fan-card.md`) et un schéma de sortie fermé sur les codes du § 3. Ses propositions s'écrivent sans attendre d'approbation : c'est ce qui épargne la note aux chatteurs, et le § 6 protège ce qu'un humain a écrit. Les `factsProposed` du brouillon restent, et le premier des deux qui écrit gagne (règle actuelle de `planFacts`). Ses appels comptent dans le budget « chatting » et coupent avant la réponse à un fan quand le budget du jour est presque atteint.

8. **Ce que la fiche ne garde jamais.** Ni nom de famille, ni adresse, ni téléphone, ni e-mail, ni employeur nommé, ni compte de réseau social, ni plaque, ni rien qui le désigne hors de la plateforme ; ni santé détaillée, ni religion, ni opinion politique, ni origine. Un événement de santé se note sans diagnostic (« opéré jeudi ») et expire 30 jours après sa date ; un `life_event` daté expire 30 jours après sa date. Le code filtre ces formes (même détecteur que les gardes de contact) avant l'écriture ; une valeur filtrée n'est pas écrite.

9. **Ce que chaque case change chez l'agent, en code.**
   - **Le bloc des notes du fan est filtré par rôle, en code et testé** : une liste fermée de cases réservées au cerveau (`payday`, `attachment`, `moods`) n'entre jamais dans le prompt de la voix, quelle que soit la consigne du prompt.
   - `payday` sert à choisir le moment d'une offre ou d'une relance permise, jamais à en ouvrir une de plus. Comme il n'atteint pas la voix, elle ne peut pas dire « t'as été payé ? ». Un fan qui dit n'avoir plus d'argent passe en gel des ventes (`salesFrozen`, inchangé), et le jour de paie ne le lève jamais ; seul un humain le lève.
   - `attachment` fort ne monte jamais la pression de vente. Avec une humeur de détresse ou des dépenses qui montent vite, il propose à un humain de marquer le fan « fragile » (`fragile`), sans jamais le faire seul (`fans.flags`, écrit par la politique ou un humain). La proposition est une ligne ambre de « À traiter » (`/v1/dashboard/todos`, module `supervision`), qu'un humain accepte ou écarte.
   - `limits` et `dislikes_about_her` entrent dans le prompt du cerveau comme ce qu'il ne faut pas proposer ; `intensity` et `lead` orientent le ton, sans jamais élargir ce que la créatrice fait : ses règles strictes (ADR 0079) restent le plafond.
   - Les cases n'entrent dans les prompts que dans le bloc des notes du fan, délimité et typé, filtrées comme aujourd'hui (`screenNotes`, `withoutOrders`) : ce qu'il a écrit reste une donnée.

10. **Qui la voit, et où.** Le propriétaire, les managers actifs et les chatteurs qui ont accès à la créatrice (ADR 0024, ADR 0025), dans le Suivi du CRM et dans le panneau de l'extension à côté de la conversation sur la plateforme ; même contrat Zod `strict` des deux côtés. La créatrice ne la voit jamais (ADR 0063). Aucune case ne part dans une alerte Telegram, un export ou un journal ; les logs ne portent que des codes de case. Le fan ne sait jamais qu'une fiche existe, et rien dans la fiche ni dans l'écran ne change la règle qu'elle ne dit jamais être une IA (ADR 0021).

11. **La note client de la plateforme ne change pas.** Elle reste lue en direct et jamais copiée (ADR 0018 § 1). Écrire un résumé de la fiche dans la note client (`setFanNote`) attend la capture Reveal et l'ouverture des écritures, par une ADR à part.

12. **Données.** `fan_facts` reste la table : `kind` gagne `noted`, une colonne `noted_by` (le `user` qui a écrit, `null` sinon) et une ligne de retrait ; la clé d'une case est son code. Une migration, numéro demandé au coordinateur, RLS inchangée (table existante, déjà en `tenantPolicy`, lecture créatrice refusée). Les tests et évals n'utilisent que des fans inventés (ADR 0010).

## Lots

- (a) Contrats (`FanCardFieldSchema`, vue de la fiche), migration, règles du domaine `fans` (force des sources, retrait, filtre du § 8), routes de lecture et de correction (`GET /v1/fans/:id/card?creatorId=` rend `FanCardViewSchema`, `strict` ; `PUT /v1/fans/:id/card/:field` corrige, ajoute ou efface une case avec `SetFanCardFieldBodySchema` ; mêmes rôles et même 404 que `GET /v1/fans/:id/flags`, déclarées au harnais d'isolation). Tests unitaires et d'intégration.
- (b) Le job `fans.read_card`, son prompt et ses évals (scénarios inventés : un jour de paie deviné, un « je déteste les talons », une contradiction avec un chatteur, une tentative d'ordre dans un message), `KYC_ASKABLE`, le filtre par rôle du bloc des notes et son test. Fil Agent.
- (b2) La proposition « fragile » dans « À traiter » (supervision). Fil Agent.
- (c) La fiche dans le Suivi du CRM : lecture, correction, « à vérifier ». Fil Extension, captures Nuit/Jour, PC et téléphone.
- (d) Le bloc fiche dans le panneau de l'extension, quand le panneau copilote existe (son ADR à part). Fil Extension.

## Conséquences

Positives :
- Le chatteur n'écrit plus de note : il relit et corrige.
- Une passation se fait sur une fiche rangée, la même pour tous, avec la source de chaque ligne.
- Le KYC actif reste à six cases : la fiche s'enrichit sans transformer la conversation en interrogatoire.
- Les faits déjà en base remplissent la fiche sans reprise.

Négatives, à surveiller :
- **Rien ne se remplit en réel tant qu'Impera ne lit pas les messages de la plateforme** (connecteur de messagerie ou capture). Avant cela, la fiche ne vit que dans le bac à sable (ADR 0075).
- Un modèle qui devine se trompe : le jour de paie, l'attachement ou l'intensité sont des hypothèses. L'écran le dit, et la correction coûte un geste.
- Le job coûte un appel par lot de messages par conversation active. À surveiller dans le budget du jour ; si c'est trop, on allonge l'attente avant lecture.
- Fantasmes, limites et intensité touchent à la vie sexuelle du fan, une donnée sensible. Ils restent dans l'agence, ne sortent dans aucun export, et la purge de 12 mois s'applique ; la base légale de leur traitement est à faire relire par un juriste avant le passage en réel avec plusieurs créatrices.
- Une liste fermée rate des choses ; « Autres » les garde, et une case nouvelle passe par une PR.

## Alternatives rejetées

- **Une note en texte libre écrite par l'IA** : impossible à ranger, à comparer ou à corriger case par case, et une passation redevient une lecture.
- **Garder des clés libres** : trois noms pour la même chose, rien qu'un écran puisse aligner.
- **Faire approuver chaque fait par un chatteur** : c'est le travail qu'on veut lui épargner ; le § 6 suffit à protéger ce qu'il a écrit.
- **Laisser le cerveau demander toutes les cases** : vingt cases à chercher font le questionnaire que Charles ne veut pas.
- **Copier la fiche dans la note client de la plateforme dès maintenant** : contraire à l'ADR 0018 § 1 tant que l'écriture n'est pas ouverte, et à décider à part.
