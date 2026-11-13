# 0091. La consommation IA dans le CRM : la dépense lue dans `llm_calls`, les crédits prépayés décomptés depuis la saisie des recharges

Statut : accepted (choix « Saisie des recharges » de Charles sur la carte de décision du 11/11/2026, 18 h 43, et « ok conso-ia » du 11/11/2026, fil « Suivre la consommation IA en direct » : ambre sous 5 jours de crédits, rouge sous 2 jours, alerte Telegram au premier franchissement ; numéro attribué par le coordinateur)
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

## Conséquences

- Le décompte s'écarte du vrai solde si un appel est fait hors du CRM (console, autre outil) : l'écran invite à noter le solde lu de temps en temps, ce qui recale tout.
- Les devises restent celles du fournisseur (dollars chez xAI) ; la conversion avec l'euro suit le taux du plafond du jour.
- Nouvelle table en `FORCE ROW LEVEL SECURITY`, nouveau type d'événement `ai_credits_low`, nouveau job horaire `ai_usage.check_credits`, trois routes sous `/v1/settings/ai-usage`.
