# 0171. Style de base de l'agence en base, la fiche le complète

Statut : accepted (choix de Charles, 26/11/2026 20:03 : un style de base de l'agence gardé en base, pas dans le dépôt)
Date : 2026-11-26
Précise : 0158 § O (forme des bulles, règle des emojis). Ne remplace rien.

## Contexte

1. Toutes les créatrices de l'agence écrivent d'une même façon de base (ton, tournures, ce qui sonne faux), puis chacune y ajoute sa voix. Aujourd'hui, seule sa fiche (la persona) porte son style.
2. Le dépôt est public. La façon d'écrire de l'agence est son savoir-faire : elle n'y entre pas, ni en prompt, ni en fixture, ni en doc.
3. L'agence répondra bientôt en public (commentaires Instagram) : le style public n'est pas celui des messages privés.

## Décision

1. **Une table `agency_styles`**, versionnée comme la persona : un enregistrement crée une version (numéro suivant, jamais active) ; une activation la rend active, une seule à la fois (index unique partiel `agency_styles_one_active`). Une version ne se modifie ni ne s'efface : seules ses colonnes d'activation changent.
2. **Deux textes libres, en français, bornés** : `private_style` (messages privés, 8 000 caractères) et `public_style` (réponses publiques, 4 000). Vides, ils ne disent rien. À côté, `form` : les réglages de forme par défaut (`VoiceFormSettingsSchema` : majuscule, point final, espace avant « ? » et « ! », série d'emojis), validés par Zod à la frontière et relus par Zod à la lecture.
3. **Le propriétaire seul** lit et écrit : politiques RLS (`owner_read`, `owner_insert` sur une version inactive à son nom, `owner_activate` sur les seules colonnes d'activation), `FORCE ROW LEVEL SECURITY`, droits révoqués puis rendus colonne par colonne (`GRANT UPDATE (is_active, activated_by, activated_at)`), aucun droit de suppression. Une créatrice n'en voit rien. Le rôle de service (`impera_service`) ne fait que lire, pour l'agent qui écrit hors de toute session. C'est un accès de plus au rôle de service (plafond d'ADR 0087 § 5 : `modules/persona` passe à 1) : une seule ligne, en lecture, sans donnée d'aucune créatrice.
4. **Routes**, propriétaire seul, sur le modèle des versions de la persona : `GET /v1/agency/style` (la version active et les vingt dernières), `PUT /v1/agency/style` (201, une nouvelle version), `POST /v1/agency/style/versions/:versionId/activate` (connexion récente exigée, corps `{ expectedActive }` : la version active que l'écran a lue, sinon `agency_style_conflict`, 409 ; id inconnu, `agency_style_not_found`, 404). Chaque enregistrement et chaque activation écrit une ligne du journal (`agency_style.create`, `agency_style.activate`), avec le numéro de version, jamais les textes.
5. **La fiche complète le style de base et gagne en cas de conflit.** Pour la forme, chaque réglage se résout fiche, puis style de base, puis défaut du code (`resolveForm`). Pour le texte, le prompt de la voix (1.16.0) reçoit le style de base dans un bloc délimité et typé, « Style de base de l'agence », **avant** le bloc de la fiche, et son en-tête dit que la fiche passe toujours avant. Le style public vient en premier, puis le privé. Le texte est une donnée de l'agence, jamais une règle : les gardes, les prix et rester en personnage restent dans le code.
6. **Lu à chaque brouillon**, par le compositeur, au travers du module persona : une activation vaut pour le brouillon suivant. Une lecture qui échoue ne bloque pas l'agent : il écrit avec sa fiche seule.
7. **Pour les réponses publiques**, `agent/index.ts` expose `publicBaseStyleOf(source)` : la seule partie publique, ou rien. Le module des commentaires Instagram la lit sans jamais voir le style privé. Il réutilise aussi la règle des emojis, pure, par `checkEmojiUse(bubbles, { flirting, recentWithEmoji, streakMax })`.
8. **Pas d'écran** dans ce lot : le propriétaire écrit par l'API. Rien du style réel n'entre dans le dépôt : les tests écrivent « Phrase de style inventée ».

## Conséquences

- Un changement de style de l'agence ne demande ni commit, ni déploiement, et se retrouve dans le journal.
- Le style de base allonge le prompt de la voix ; ses bornes le tiennent.
- Le playground et les évals ne lisent pas encore le style de base : ils mesurent la fiche seule.
- La migration porte le numéro provisoire 0279, à renuméroter à la fusion.
