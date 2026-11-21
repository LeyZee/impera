# 0091. La consommation IA dans le CRM : la dépense lue dans `llm_calls`, les crédits prépayés décomptés depuis la saisie des recharges

Statut : accepted (choix « Saisie des recharges » de Charles sur la carte de décision du 11/11/2026, 18 h 43, et « ok conso-ia » du 11/11/2026, fil « Suivre la consommation IA en direct » : ambre sous 5 jours de crédits, rouge sous 2 jours, alerte Telegram au premier franchissement ; numéro attribué par le coordinateur ; § 6 amendé par « ok 0091 abonnement » du 13/11/2026, 2 h 03, et « ok 0091 chiffres » du 13/11/2026, 2 h 56 ; § 7 ajouté par « ok essai IA » du 16/11/2026, 13 h 25)
Date : 2026-11-11
Précise : l'ADR 0016 (clés des fournisseurs saisies dans le CRM, jamais dans le dépôt ni le chat) et le plafond du jour de `packages/llm` (20 € par jour, heure de Paris). Ne remplace rien.

## Contexte

Charles recharge à la main des crédits prépayés chez xAI (Grok, modèle principal) et suit la dépense dans la console de chaque fournisseur. Il veut tout voir dans le CRM : ce que l'IA coûte en direct, par fournisseur, par modèle et par usage, la tendance, et surtout quand recharger pour ne jamais tomber à court.

Ce qui existe déjà : chaque appel de modèle est écrit dans `llm_calls` avec son fournisseur, son modèle, son rôle, ses jetons et son coût exact en micro-dollars. Le plafond du jour s'en sert déjà.

Ce que les fournisseurs permettent (documentation lue le 11/11/2026) :
- xAI expose le solde prépayé par son API de gestion, avec une clé de gestion distincte de la clé d'appel. Cette même clé peut aussi déclencher une recharge sur la carte : on ne la relie pas sans un accord écrit de Charles.
- Mistral n'expose aucun solde par API pour notre offre ; un compte vide répond 402.
- Google facture en fin de mois sur le compte de facturation.

On ne peut donc pas lire le solde avec les clés que le CRM a déjà.

## Décision

1. **La dépense vient de `llm_calls`, rien d'autre.** L'écran Réglages › Consommation IA (propriétaire seul) lit le journal : le jour en cours face au plafond, les heures du jour, les 30 derniers jours empilés par fournisseur, la répartition par modèle et par usage (écrire les messages, décider quoi répondre, regarder les médias, veille, tests de qualité), le rythme moyen et la projection du mois. Le coût d'un appel est celui du journal ; un appel sans coût connu compte le même forfait prudent que le plafond du jour.

2. **Les crédits prépayés sont un décompte, depuis la saisie du propriétaire.** Une table `ai_credit_entries` garde ce qu'il note : une recharge (montant ajouté) ou un solde lu dans la console (il remplace le décompte à partir de cet instant). Le solde affiché vaut le dernier solde lu, plus les recharges notées depuis, moins le coût des appels de ce fournisseur faits depuis. Chaque saisie a un identifiant choisi par l'écran : la rejouer n'écrit rien deux fois. Une saisie faite par erreur se retire, et le journal d'audit garde l'ajout comme le retrait.

3. **Combien de jours il reste.** Le rythme est la dépense moyenne par jour des sept derniers jours complets (moins si le journal est plus jeune). Les jours restants sont le solde divisé par ce rythme, avec la date estimée de fin. Sans journée complète, l'écran dit « Rythme à venir » plutôt qu'un chiffre faux.

4. **Seuils (choix de Charles).** Ambre sous 5 jours de crédits, rouge sous 2 jours, rouge aussi à zéro. Une vérification horaire publie `ai_credits_low` au premier franchissement de chaque seuil depuis la dernière saisie ; Telegram l'envoie en « important » (ambre) ou « urgent » (rouge et épuisé). Une nouvelle saisie remet les seuils à zéro.

5. **Aucun appel aux consoles des fournisseurs.** La clé de gestion de xAI n'est pas reliée : elle pourrait recharger la carte. Si Charles la veut un jour pour lire le solde exact, ce sera une nouvelle décision, avec la recharge interdite dans le code.

6. **Fournisseur payé par l'abonnement (amendement « ok 0091 abonnement » de Charles, 13/11/2026, 2 h 03).** Charles a constaté sur sa page Usage de xAI que les appels de Grok passent sur l'usage inclus dans son abonnement (quota hebdomadaire), sans crédit prépayé : l'usage inclus est consommé avant les crédits, et sans crédit xAI refuse les appels une fois le quota épuisé. Pour un tel fournisseur :
   - le propriétaire note « Payé par l'abonnement » (une ligne `subscription` du registre, sans montant) ; la carte dit « Inclus dans l'abonnement », sans solde ni jours restants, avec la valeur consommée depuis à titre indicatif et l'endroit de la console où lire le quota. Une recharge ou un solde noté plus tard reprend le décompte des crédits à partir de cette ligne ;
   - un appel refusé faute de crédits ou de quota (402, ou 403 et 429 dont la réponse le dit) est journalisé `quota_exhausted` : ni réessayé, ni pris pour une clé refusée (la clé n'est pas marquée « à reconnecter »), et la réponse du fournisseur n'est jamais gardée (elle nomme l'équipe). L'agent continue avec son modèle de repli ;
   - la vérification passe toutes les cinq minutes et publie `ai_quota_exhausted` au premier refus depuis la dernière réponse du fournisseur, une fois par épisode, crédits ou abonnement ; Telegram l'envoie en « urgent ». La carte passe au rouge « Quota épuisé » jusqu'à la prochaine réponse ;
   - aucune API ne donne le pourcentage du quota : le CRM ne l'invente pas, il prévient au premier refus ;
   - les chiffres gardent ce fournisseur (« ok 0091 chiffres » de Charles, 13/11/2026, 2 h 56) : « Aujourd'hui », « Ce mois-ci » et « Prévu fin du mois » le comptent, avec en dessous « dont X € couverts par l'abonnement » ; le graphique hachure, dans la couleur du service, la part couverte. Une dépense est couverte quand elle tombe entre une ligne `subscription` du fournisseur et sa recharge ou son solde suivant, à l'heure près (le grain du journal). La projection compte comme couvert, pour les jours restants, le rythme propre de chaque fournisseur encore sur l'abonnement. Le plafond du jour compte tout, abonnement compris : il protège aussi contre un emballement.

7. **Chaque service branché, prouvé et suivi (amendement « ok essai IA » de Charles, 16/11/2026, 13 h 25).** La vérification d'une clé (ADR 0016) lit des pages gratuites : elle prouve la clé, pas que le compte peut encore payer une génération. Charles veut savoir, service par service, si tout fonctionne et s'il faut recharger.
   - **« Essai réel »** sur chaque service branché dans Réglages › Services : un tout petit appel réel, au clic du propriétaire seulement, jamais par une tâche. Pour Grok, Gemini et Mistral, la passerelle demande « Réponds seulement : ok » (16 jetons au plus) au modèle qu'utilise l'agent pour ce fournisseur ; l'appel est journalisé dans `llm_calls` avec l'usage `probe`, compté dans la dépense et arrêté par le plafond du jour comme tout autre, mais laissé hors de la santé de l'agent (un essai raté ne dit pas à la supervision que l'agent est en panne). Pour ElevenLabs, un « ok » prononcé avec la voix choisie sur le modèle le moins cher, deux caractères du mois, le son jeté sans être gardé. Coût écrit à côté du bouton : moins d'un centime, ou deux caractères. Le résultat dit en clair « Répond », « Plus de crédit », « Clé refusée », « Modèle absent du compte », « Trop d'appels », « Trop lent », « Ne répond pas », « Plafond du jour atteint » ou « Aucune voix choisie », avec la durée et le modèle. Une clé refusée sur cet appel passe au rouge aussitôt, comme un refus vu en production ; les autres résultats laissent l'état aux vérifications. Le dernier essai est gardé avec la clé et oublié quand elle est remplacée.
   - **Santé de chaque service**, gratuite, lue dans `llm_calls` sur 24 heures : dernier appel réussi, nombre d'appels et d'erreurs de connexion (crédit ou quota, clé, modèle, débit, lenteur, panne ; jamais un refus de contenu ni une réponse mal formée), fois où le service a pris le relais d'un autre, et la dernière erreur des 7 derniers jours tant qu'aucun succès ne l'a suivie.
   - **ElevenLabs dans Consommation IA** : il compte en caractères, pas en argent. Sa carte montre les caractères restants du mois, environ combien de vocaux, la date où le mois revient et l'offre gratuite, lus par la vérification de la clé (toutes les 15 minutes ou « Vérifier maintenant »). Ambre sous 10 %, rouge à zéro, comme sa ligne de Services. L'offre gratuite d'ElevenLabs interdit l'usage commercial : l'écran le dit, sans rien bloquer.
   - La clé de gestion de xAI reste non reliée (§ 5) : Grok est sur l'abonnement, dont aucune API ne donne le quota.

8. **Le prévisionnel (demande de Charles, 21/11/2026, 13 h 03 : « le bloc prévisionnel, ce mois-ci, le mois suivant, bas, réaliste et haut, par poste, avec l'effet de 50 % de trafic en plus », pour sa trésorerie).** Un bloc « Prévisionnel » dans Consommation IA, calculé par le serveur depuis `llm_calls` et le registre des ventes, sommes seulement :
   - **Rythme** : la moyenne par jour de la dernière semaine complète (comme « Prévu fin du mois ») ; le **bas** et le **haut** sont la plus calme et la plus chargée des deux dernières semaines. Sous huit jours de recul, une bande fixe de −20 % / +25 %. Ce mois-ci = déjà dépensé + rythme × jours restants ; le mois suivant = rythme × ses jours.
   - **Par usage** : Chatting Reveal (les appels d'une créatrice), Médias et scripts décrits (usage `media`), Canal Telegram (usage `telegram`), Instagram (commentaires et veille), Playground et tests (appels sans créatrice, et le juge), Essais des services. Les usages `media` et `telegram` sont posés par la passerelle elle-même sur ses appels dédiés ; le plafond du jour et la santé les comptent comme avant.
   - **Par créatrice**, avec ses conversations par jour et la part de ses ventes.
   - **Trafic** : avec 50 % de conversations en plus, seul le chatting grandit ; le coût d'une conversation sur une journée est le chatting de la semaine divisé par ses conversations-jours.
   - **Plafond** : quand le rythme réaliste, ou celui avec plus de trafic, dépasse le plafond du jour, un avertissement ambre le dit, avec le maximum du mois suivant et le plafond qu'il faudrait pour tout laisser à l'IA.
   - **Ventes** : le net de Reveal en euros, remboursements déduits, sur les mêmes jours et prévu de la même façon ; le coût de l'IA en part de ces ventes. Une comparaison à une commission de chatteurs attendra un taux saisi par le propriétaire : aucun taux de l'agence n'est écrit dans le code.

## Conséquences

- Le décompte s'écarte du vrai solde si un appel est fait hors du CRM (console, autre outil) : l'écran invite à noter le solde lu de temps en temps, ce qui recale tout.
- Les devises restent celles du fournisseur (dollars chez xAI) ; la conversion avec l'euro suit le taux du plafond du jour.
- Nouvelle table en `FORCE ROW LEVEL SECURITY`, nouveau type d'événement `ai_credits_low`, nouveau job horaire `ai_usage.check_credits`, trois routes sous `/v1/settings/ai-usage`.
- Amendement § 6 : migration 0204 (`subscription` dans le registre, statut `quota_exhausted` du journal indexé par fournisseur, événement `ai_quota_exhausted` dans les contrôles de type et le déclencheur Telegram) ; la vérification passe de l'heure aux cinq minutes.
- Amendement § 7 : migration 0221 (usage `probe` dans `llm_calls`, dernier essai et mois d'ElevenLabs dans `provider_credentials`) ; route `POST /v1/settings/providers/:provider/probe` (propriétaire, quatre par minute) ; la carte ElevenLabs dans `GET /v1/settings/ai-usage` (`voice`).
- Amendement § 8 : migration 0245 (usages `media` et `telegram` dans `llm_calls`) ; une lecture de plus par le rôle de service dans `ai-usage` (le journal par usage et par créatrice, les ventes et les noms des créatrices, en une requête), plafond de `service-role-ceiling.ts` monté de 9 à 10 et total de 277 à 278.
