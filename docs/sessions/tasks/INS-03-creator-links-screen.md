# INS-03 « Mes liens » chez la créatrice : ses liens de redirection, leur phrase d'usage, un bouton Copier
Statut : done (fusionnée le 19/11/2026, #847 ; captures validées par Charles les 16 et 17/11)
Phase : Instagram (ADR 0121)
Dépend de : ADR 0121 acceptée ; l'endroit d'un lien (ADR 0120 § 3, migration partagée avec INS-02)
Branche : task/ins-03-creator-links-screen
Propriétaire : fil Instagram ; relecture Design (écran de la créatrice) et Bilan (migration, route)

## Objectif
La créatrice ouvre « Mes liens » sur son téléphone, lit à quoi sert chaque lien et le copie d'un geste.

## Contexte à lire
ADR 0121 § 1, ADR 0120 § 3, ADR 0080 § 4, ADR 0042, `packages/contracts/src/telegram-channel.ts`, `apps/web/src/creators/telegram/`.

## À faire
- [x] Migration nouvelle et additive sur le lien de redirection : endroit (`NULL` pour les liens existants) et phrase d'usage (120 caractères au plus, jamais d'adresse).
- [x] Contrats Zod : phrase d'usage, carte de lien montrée à la créatrice (nom, endroit, phrase, adresse).
- [x] Agence : endroit et phrase d'usage réglables dans l'écran des liens de redirection ; un lien existant affiche « à renseigner ».
- [x] Créatrice : route de lecture de ses seuls liens actifs qui ont un endroit, ordre des endroits (story du jour d'abord).
- [x] Écran « Mes liens » téléphone d'abord : une carte par lien, bouton Copier avec retour visible, aucun chiffre.
- [ ] Captures Nuit/Jour, téléphone et PC, vues par Design puis par Charles avant fusion.

## Critères d'acceptation
- Une créatrice ne lit jamais les liens d'une autre (test d'isolation) ; route nouvelle : authentication-sweep, origin-sweep.
- Un lien sans endroit ou éteint n'apparaît pas ; une phrase d'usage qui contient une adresse est refusée.
- Aucune adresse ni domaine réel dans un test, une fixture ou une doc.

## Exigences de la relecture Sécurité (PR #810)
Pour cette fiche :
- La route de « Mes liens » est derrière la porte de la créatrice, avec un cas dans le harnais d'isolation : une autre créatrice ne reçoit rien.
- Schéma de sortie strict : nom, phrase d'usage, adresse à copier, endroit. Aucun compteur, aucun identifiant du service de redirection, aucun lien de suivi, aucun palier. Un test montre qu'un champ en plus ne sort pas.
- La phrase d'usage est validée côté serveur (120 caractères, aucune adresse) et rendue comme du texte. Elle n'entre dans aucun prompt.

Pour les fiches suivantes de l'ADR 0121 (à recopier à leur création) :
- Rattachement d'un lien de suivi : unicité tenue par la base, même créatrice des deux côtés (clé composée), test d'isolation ; geste de l'agence seulement, avec sa ligne d'audit.
- Paliers, récap, régularité, alertes : tables en FORCE RLS, droits du rôle de service, aucune politique pour la créatrice ; aucune route de la créatrice ne les rend.
- Les valeurs des paliers et du délai ne sortent ni dans les journaux applicatifs ni dans un outil d'agent externe tant qu'une décision ne le dit pas.
- Récap : le prompt reçoit les faits calculés et la position par rapport aux paliers, jamais leurs valeurs ; les légendes lues sur le compte y entrent comme texte non fiable et typé ; le refus d'un chiffre non reçu est fait par le code.
- Notifications et tuile du Dashboard : propriétaire et managers seulement, pour les créatrices qu'ils ont le droit de lire.

## Hors périmètre
Le rattachement à un lien de suivi, les paliers, l'écran « Trafic » et le récap (fiches suivantes de l'ADR 0121) ; le rappel de story.

## Notes de session

- 16/11 : les liens de redirection vivent aujourd'hui dans le JSON du canal Telegram (lecture admin seule). Décidé avec le fil Bilan : table `redirect_links` dans un module à part `redirect-links` (domaine et port), lu par telegram et par le connecteur de liens via son `index.ts`. Conditions de Bilan : écritures dans la table seulement dès cette PR, JSON lu en repli une version (son vidage est une migration à part, destructive, sur le mot de Charles) ; recopie dans la migration, idempotente (`ON CONFLICT (id) DO NOTHING`, identifiants gardés) avec un test d'intégration qui la rejoue ; FORCE RLS, lecture par la créatrice sur ses lignes, écriture par le service, `GRANT SELECT … TO impera_service`, test d'isolation ; `url` en CHECK `^https://`, `placement` NULL ou dans la liste fermée, unique (creator_id, name). Numéro de migration provisoire 0221, fixé au signal.
- Fait en local : contrats `creator-links` (cartes, phrase d'usage, ordre) et leurs tests.
