# La plateforme propre (phase 8) : ce que le cœur ne doit pas supposer

Dernière revue : 2026-10-16. Décision : ADR 0003.

Charles prévoit une plateforme privée **dédiée à une seule créatrice** (Messalina), pour s'affranchir de Reveal et d'OnlyFans, **sans système d'abonnement**. Elle n'est pas dans le périmètre avant la phase 8, mais plusieurs choix d'aujourd'hui la rendent facile ou impossible. Ce document liste ce que le cœur doit respecter dès maintenant.

## Ce qu'elle sera (hypothèse de travail)

- Un site/app fan-facing (`apps/platform`), une seule créatrice, compte fan par email/passkey, pas d'abonnement récurrent : paiement à l'unité (média, custom, pourboire) et/ou crédits prépayés, messagerie 1:1 avec la créatrice (donc avec l'agent), galerie, demandes personnalisées.
- Un connecteur **in-process** (`ImperaPlatformConnector`) : pas de réseau, pas de session à capturer, pas de scraping. Le cœur reçoit les messages par appel direct et envoie de même. Latence nulle, fiabilité totale, c'est là que l'architecture adaptateurs paie.
- Paiements via un prestataire qui accepte le contenu adulte (CCBill, Segpay, Epoch, Verotel ; Stripe et PayPal refusent). Le module `payments` sera nouveau et isolé.
- Hébergement et conformité propres (vérification d'âge selon la loi applicable, mentions légales, modération des contenus, DMCA).

## Règles pour le cœur, dès la phase 0

1. **Pas de notion d'abonnement dans le cœur.** `fans` n'a ni `subscribed_at` ni `subscription_tier`. La relation fan ↔ créatrice est décrite par des faits et des événements (`sale_detected`, `first_seen_at`), pas par un statut d'abonné. Si Reveal expose un statut d'abonnement, il vit dans `fans.platform_meta jsonb`, pas dans une colonne du cœur.
2. **Les ventes sont typées, pas « des PPV ».** `sales.kind ∈ {ppv_unlock, tip, custom_request, credit_purchase, chat_unlock, other}`. Le cœur raisonne sur « ce fan a payé X pour Y », jamais sur un mécanisme de plateforme.
3. **Les médias ont des droits, pas une plateforme.** `media_assets.rights` dit où et comment un média peut être vendu ; un média peut être vendu sur Reveal et sur Impera. L'anti-doublon est par fan (`media_sends`), pas par plateforme.
4. **L'identité d'un fan est par compte plateforme, avec `person_id` prévu.** Le jour où un fan de Reveal migre sur Impera, on relie les deux (`persons`), et la mémoire suit.
5. **Le connecteur est une interface, pas un client HTTP.** `PlatformConnector` ne suppose ni réseau, ni session, ni polling : `ImperaPlatformConnector` implémentera `subscribe` par événements internes et `health` retournera toujours `valid`.
6. **La persona et l'agent ne savent pas où ils parlent.** Le contexte contient `platform` comme information (le ton peut varier), jamais comme condition de logique dans le domaine.
7. **Les prix sont des données de la créatrice** (`offers`), pas de la plateforme. Une plateforme peut imposer des bornes (`connector.capabilities.priceBounds`), le cœur les applique.
8. **Authentification des fans** : rien aujourd'hui, mais `users` (dashboard) et futurs `fan_accounts` (plateforme) sont deux tables distinctes dès le départ ; on ne « réutilise » pas `users` pour les fans.
9. **Fichiers** : stockage objet S3-compatible dès la phase 3 (pas le disque du serveur), avec URL signées, pour pouvoir servir les médias à la plateforme sans migration.
10. **Multi-créatrices possible, mono-créatrice assumé** : la plateforme sera mono-créatrice, mais le tenant reste `creator_id` ; aucune constante « la créatrice » dans le code.

## Ce qui sera nouveau en phase 8 (et n'a pas besoin d'exister avant)

- Modules `platform` (comptes fans, galerie, messagerie côté fan, demandes custom) et `payments`.
- `apps/platform` (Next.js ou Vite, à décider alors ; SEO et SSR comptent pour un site public, donc probablement Next.js à ce moment-là).
- Vérification d'âge, modération, signalement, conformité.
- Notifications fans (email, push).

## Risque à surveiller

La tentation d'ajouter « juste une colonne » liée à Reveal dans une table du cœur. La revue de PR vérifie que toute donnée spécifique à une plateforme va dans un `platform_meta jsonb` ou dans le module `connectors`.
