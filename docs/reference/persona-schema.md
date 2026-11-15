# Schéma de la persona

Fichier : `personas/<creator>/vX.Y.Z.yaml`. ADR 0010, ADR 0079. Deux formats se lisent, `meta.schema` 1 et 2 (`StoredPersonaSchema`) ; une version enregistrée n'est jamais réécrite. Toute nouvelle version s'écrit au format 2.

## Format 2 : la fiche de Desirali (ADR 0079)

Schéma Zod : `packages/contracts/src/persona-sheet.ts` (`PersonaV2Schema`, `PersonaSheetSchema`, `PersonaAgentSettingsSchema`). Les questions, leurs libellés mot pour mot, leur ordre, leur largeur à l'écran et leurs aides : `PERSONA_SHEET`, la seule liste que l'écran, la complétion et l'agent lisent. Exemples : `personas/demo/v0.4.0.yaml` (créatrice fictive, toutes les questions remplies sauf le poids et le nombre de partenaires ; `v0.3.0.yaml` est la même sans les ajouts de l'ADR 0090) et `personas/messalina/v0.1.0.yaml` (placeholders).

Le fichier a trois parties : `meta` (comme au format 1, `schema: 2`), `sheet` (la fiche, 7 panneaux, 61 questions) et `agent` (« Réglages de l'agent »).

| Panneau (`sheet.<clé>`) | Titre à l'écran | Questions (clés de Desirali) |
|---|---|---|
| `identity` | Identité et informations de base | `physical_description`, `shoe_size`, `birth_date`, `height_m`, `weight_kg`, `country`, `city`, `nickname`, `job`, `eye_color`, `hair_color`, `breast_size`, `place_of_life`, Fuseau horaire (affiché, pas dans le fichier), `spoken_languages` |
| `lifestyle` | Mode de vie | `smoking_habit`, `drinking_habit`, `traveling`, `routines`, `pets`, `dream_car` |
| `preferences` | Préférences | `favorite_color`, `least_favorite_color`, `passions`, `favorite_dishes`, `least_liked_dishes`, `religion`, `music_genres`, `favorite_movies`, `favorite_celebrities`, `favorite_characters`, `favorite_books` |
| `conversation` | Style de conversation | `roleplaying_description`, `favourite_emojis`, `conversation_description`, `spelling_description`, `compliment_description`, `flirt_description`, `common_expressions`, `typical_responses`, `limit_setting_description` (« Comment elle dit non »), `sounds_wrong_description` (« Ce qu'elle n'écrirait jamais ») ; les deux dernières, ADR 0090 § 12, guident la voix et ne bloquent rien |
| `relationships` | Relations | `relationship_status`, `kids_status`, `body_count`, `turn_ons`, `turn_offs`, `ideal_man`, `ideal_date` |
| `intimacy` | Intimité | `libido_level`, `domination_preference`, `style_in_private`, `sex_toys`, `squirting`, `cum`, `kinks`, `fetichism`, `favorite_positions`, `fantasies`, `no_go_zones` |
| `boundaries` | (aucun titre) | `off_limits` (« Zones interdites ») |

| `agent.<clé>` | Contenu | Lu par |
|---|---|---|
| `strategies` | comme `strategies` au format 1 (KYC et cases à apprendre, sexualisation, lancement des scripts, suivi d'offre) | la politique ; les consignes écrites vont aux modèles sans leurs chiffres |
| `follow_ups` | comme au format 1 | la planification des relances |
| `notifications` | comme au format 1, dont `alert_keywords` | les alertes |
| `behavior` | `split_messages`, `pet_names` (les seuls surnoms qu'elle donne), `response_delay_minutes` | l'envoi et les gardes |
| `rules` | `never_do`, `never_show`, `never_say`, `disgusts`, `emojis_forbidden` : les règles strictes, en listes de mots | les gardes (`guards.ts`) |
| `objection_replies` | facultatif, défaut `{}` : par type d'objection de prix (`too_expensive`, `real_is_cheaper`, `free_elsewhere`, `asks_discount`, `already_paid`), une liste de `{ id, text }` dans l'ordre de l'agence (ADR 0090 § B) | le choix d'une réplique jamais reçue par ce fan ; seule la réplique choisie va à la voix. Lu par le propriétaire seul ; les autres rôles reçoivent `{}`. Le dépôt ne porte que des répliques de test |

Règles du format 2 :
- **Texte libre partout**, une réponse vide vaut `null` : réponse courte 1 000 caractères, longue 4 000. Six réponses ne sont pas du texte : `birth_date` (ISO), `height_m` (1,3 à 2,1), `weight_kg` (40 à 130), `body_count` (entier, facultatif), le fuseau (celui de `creators.timezone`, affiché sans être modifié) et `spoken_languages` (au moins une, sans doublon, la première est la langue des réponses).
- **Trois questions obligatoires** : `nickname` (le nom sous lequel l'agent écrit), `birth_date` (au moins 18 ans et moins de 100 à `meta.created_at`), une langue.
- **Ce que l'agent lit** : toute la fiche, panneau par panneau, sous les libellés de Desirali, sauf ce qui est vide ou `<à remplir>`. L'âge remplace la date de naissance ; le fuseau n'y est pas ; « Zones interdites » se lit seul, sans titre. Suivent les réglages que les prompts nomment : `behavior` (découpage, surnoms), `strategies` (consignes écrites), `kyc_collect`, `limits` (les règles strictes). Aucune réponse de la fiche n'est une règle : le code n'en tire rien.
- **« Réponses typiques »** : une réponse par ligne, `situation : réponse` ou la réponse seule. À l'enregistrement et à l'activation, chaque ligne passe les gardes dures (422 `persona_sample_reply_unprocessable`, `index` = numéro de ligne à partir de 0) ; la situation n'est pas lue par les gardes.
- **Répliques aux objections** : à l'enregistrement, chacune passe les gardes dures (422 `persona_sample_reply_unprocessable`, la faute porte `objection` et `index`, sa place dans la liste).
- **Complétion** (`personaSheetCompletion`) : questions remplies sur 61, le fuseau toujours compté. Ne bloque rien.
- **Format 1 ouvert** : `personaSheetFromV1` en fait un brouillon au format 2 (`GET /v1/creators/:id/persona` le rend dans `latest.draft`). Ce qui n'a pas de question à soi va dans la plus proche et figure dans `latest.moved` (l'origine va dans la description physique ; le caractère dans la description de la conversation ; langage et style d'écriture dans le style d'orthographe ; infos en plus, objectifs et ce qu'elle n'aime pas dans la description du jeu de rôle ; ses goûts dans les passions ; ce qu'elle ne fait et ne montre jamais, en plus des règles strictes, dans « Zones interdites / limites strictes »). L'agent lit une version au format 1 par cette même conversion.
- **Moi › Persona** : `GET /v1/creators/:id/persona/mine` rend `answers`, les 7 panneaux, jamais `agent`. Ses corrections nomment un panneau (`identity` … `boundaries`) ; les anciennes sections restent lues (migration 0134).

## Format 1 (lu, converti à l'ouverture)

Schéma Zod : `packages/contracts/src/persona.ts` (`PersonaSchema`, types `Persona`, listes `PERSONA_OPTIONS`, bornes `PERSONA_BOUNDS`, `ageOn`).

Schéma Zod : `packages/contracts/src/persona.ts` (`PersonaSchema`, types `Persona`, listes `PERSONA_OPTIONS`, bornes `PERSONA_BOUNDS`, `ageOn`). Fichier : `personas/<creator>/vX.Y.Z.yaml`. ADR 0010.

La structure reprend la fiche créatrice d'OnlyChat, onglet par onglet (décision de Charles, 17/10/2026 : « OnlyChat sont les boss »), ajustée par la méthode de chatting de l'agence (`/mnt/project-files/chatting/methode-chatting.md`, §6, hors dépôt) : curseurs en heures, pas de réglage de négociation, surnoms en liste fermée. Le formulaire du dashboard et l'agent lisent le même schéma et les mêmes listes de valeurs, avec leurs libellés français : le dashboard n'a pas sa propre copie.

Exemples : `personas/messalina/v0.0.0.yaml` (placeholders, la vraie persona est hors dépôt) et `personas/demo/v0.1.0.yaml` (créatrice fictive, pour les tests, les évals et la démonstration ; `v0.2.0.yaml` est la même rangée en blocs, P5-01 ; le playground et les évals lisent `v0.4.0.yaml`, au format 2).

| Section | Onglet OnlyChat | Champs | Rôle |
|---|---|---|---|
| `meta` | (aucun) | `schema` (1), `version` (semver), `creator`, `language` (`fr`), `created_at`, `notes` | identification |
| `details` | Détails | `first_name`, `date_of_birth` (l'âge en est calculé par `ageOn`, jamais saisi), `gender` (déprécié le 17/10 : facultatif, ignoré, absent de l'écran), `ethnicity`, `timezone` (IANA), `languages[]` (au moins une, sans doublon), `height_cm`, `weight_kg`, `shoe_size_eu`, `hair`, `eyes`, `bra` (`band` 65 à 105 par 5, `cup` A à H), `hobbies[]`, `personality[]` | la personne |
| `additional_info` | Infos en plus | texte libre, 6 000 caractères au plus | identité, voix, séduction, passions, objectifs |
| `behavior` | Comportement | `language_style` (`formal` / `casual`), `language_instructions`, `split_messages`, `pet_names[]` (les seuls surnoms qu'elle donne), `response_delay_minutes` (0 à 60) | comment elle écrit |
| `strategies` | Stratégies | `kyc` (`targets`, `max_messages` 1 à 500, `max_duration_minutes` 10 à 1 440, `min_hours_before_following` 0 à 24 : temps de conversation avant de suivre un fan qui sexualise), `sexualization` (`initiate_after_hours` 0 à 168 : temps de relation avant que l'agent ouvre lui-même la sexualisation ; `min_desire_to_open` facultatif, 20 à 70, défaut 40 : note de désir du fan avant qu'elle l'ouvre, P3-12), `script_launch` (`cooldown_hours` 0 à 24 entre deux scripts au même fan ; `min_desire` facultatif, 50 à 90, défaut 70 : note de désir avant un script), `post_offer` (`delay_days` 1 à 60 : relance après un refus) ; chacune a un `style` (`default` / `custom`, `normal` / `custom` pour le lancement) et des `instructions` présentes si et seulement si le style est `custom` | comment elle vend |
| `follow_ups` | Relances | `enabled`, `delays_hours[]` (strictement croissants), `type` (`soft` / `custom`, `text` si `custom`), `nudges` (`enabled`, `delay_minutes`, `max_per_day`, `min_hours_after_conversation`, `delete_previous`) | relances et petits rappels |
| `notifications` | Notifications | `sales`, `agent_disabled`, `no_script_left`, `rate_limited`, `alert_keywords[]` | qui prévenir, quand |
| `limits` | (aucun, écart admis) | `never_do[]`, `never_show[]`, `never_say[]`, `disgusts[]` | ce qu'elle ne fait, ne montre, ne dit jamais |
| `lifestyle` | (bloc P5-01, facultatif) | `occupation`, `area` (60 caractères : une région, jamais une adresse ni un lieu qui la retrouve), `routine`, `goals` | sa vie loin des fans |
| `tastes` | (bloc P5-01, facultatif) | `likes[]`, `dislikes[]` (aucune entrée dans les deux) | ses goûts |
| `intimate` | (bloc P5-01, facultatif) | `turn_ons[]`, `fantasies[]` (aucune que `limits.never_do` ou `limits.disgusts` refuse), `sexting_style` | l'intime ; ce qu'elle refuse reste dans `limits` |
| `writing_style` | (bloc P5-01, facultatif) | `message_length` (`short` / `medium` / `long`), `emojis_preferred[]` et `emojis_forbidden[]` (un emoji par entrée, drapeaux, touches et séquences compris, 20 au plus, « ❤ » et « ❤️ » comptés comme un, aucun dans les deux), `punctuation`, `capitals` (`normal` / `lowercase` / `expressive`) | comment elle écrit |
| `sample_replies` | (bloc P5-01, facultatif) | dix au plus, chacune `situation` (nullable) et `reply` (500 caractères) | ses réponses types, inventées |

Règles :
- Tout champ texte est en français. Les valeurs des listes sont en anglais (code), leurs libellés en français (`PERSONA_OPTIONS`).
- Une clé inconnue est refusée : une faute de frappe ne passe jamais en silence.
- La créatrice a au moins 18 ans à la date `meta.created_at`.
- **Appliqué par le code, pas par le prompt** (CLAUDE.md, règle 3) : `response_delay_minutes`, les délais de KYC et de sexualisation, les seuils de la note de désir, les cooldowns, `delays_hours` et les petits rappels sont lus par la politique ; `limits` et `pet_names` sont chargés par `guards.ts` ; `split_messages` à faux réunit les bulles en un seul message. L'horloge d'une créatrice est `creators.timezone`, pas `details.timezone`. Suivre un fan qui sexualise demande aussi son âge confirmé majeur. Ce sont des données de sécurité, pas seulement du style.
- **Donné aux modèles** : tout le reste de la fiche (détails sauf la date de naissance, remplacée par l'âge, le genre et le fuseau ; infos en plus ; comportement sauf le délai de réponse ; limites) et les consignes écrites des stratégies (`instructions`, `targets`), sans leurs chiffres. Les prompts disent d'écrire dans la langue du fan quand elle est dans `languages`, sinon dans la première.
- **Blocs (P5-01)** : tous facultatifs, sans valeur par défaut, donc une version publiée avant eux se lit et garde son `contentHash` ; `meta.schema` reste 1 et `additional_info` reste requis (vide permis) le temps de la transition. Une persona qui se contredit (emoji préféré et interdit, goût aimé et détesté, envie que ses limites refusent) est refusée. `strategies.kyc.collect` (facultatif, au moins une case, sans doublon) choisit les cases du canevas Reveal à apprendre, toutes sinon. `emojis_forbidden` est appliqué par une garde (`forbidden_term`), les réponses types passent les gardes dures à l'enregistrement (422 `persona_sample_reply_unprocessable`, `details.faults` lu par `PersonaSampleReplyUnprocessableDetailsSchema` : place et code de garde, jamais le texte ; codes dans `PERSONA_ERROR_CODES`). La complétion (`personaCompletion`) pèse chaque bloc, ne bloque rien. Les modèles reçoivent chaque bloc en section, et `kyc_collect` (les libellés des cases à apprendre).
- **Mots-clés d'alerte** : toujours actifs, pas d'interrupteur. Un fan qui en écrit un met l'agent en pause pour ce fan et prévient un humain.
- **Écarts admis avec OnlyChat**, tous venus d'une décision : `limits` (règle 3) ; pas de `negotiation` (on ne négocie jamais le prix, règle fixe en code, méthode §3) ; `sexualization.initiate_after_hours` en heures au lieu de `minSexualizationCooldown` (0 à 5, unité non documentée) ; `kyc.min_hours_before_following` et `behavior.pet_names` demandés par Charles ; rester en personnage est fixé dans le code (ADR 0021), ni dans la persona ni dans un réglage ; les versions passent par les tests et la validation de Messa (ADR 0010).
- **Ce qui n'est plus dans la persona** : les horaires de vie (réglages de la créatrice, phase 5), les exemples de voix (corpus validé par Messa, nourri par les corrections du playground), les kinks (dans `additional_info`, et ce qui doit être garanti, dans `limits`).
- Valeurs OnlyChat : `FORMAL` / `CASUAL`, `DEFAULT` / `CUSTOM`, `NORMAL`, `SOFT` deviennent les mêmes mots en minuscules. `negotiationStyle` n'est pas importé. Le type des petits rappels (`nudgeType`) n'est pas repris : ses valeurs ne sont pas connues.
- Aucune donnée réelle dans le dépôt : `v0.0.0.yaml` contient des placeholders `<à remplir>`, `demo` est inventée.
