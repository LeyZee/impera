# VEI-01 Signaux de tendance et idées de contenu : la base, les filtres, le lien collé
Statut : in_progress (lots a et b faits ; lots c, d à venir)
Phase : veille (ADR 0060)
Dépend de : CR-05 (suggestions de l'agenda), CR-06 (demande de contenu), pour le lot d seulement
Branche : task/vei-01-trend-signals (session : `claude/project-thread-a8l1w6`)
Propriétaire : Bilan (contrats, base, module, routes)

## Objectif
Les signaux de tendance et les idées de contenu existent en base, avec les filtres du code, et un membre de l'agence peut déjà coller un lien repéré sur Instagram.

## Contexte à lire
ADR 0060 (tout), ADR 0042 § 4, ADR 0055 § 1 et § 4, ADR 0056 § 1 (filtre des dégoûts), ADR 0057 § 6 (garde Instagram), ADR 0010.

## À faire
- [x] Contrats Zod dans `packages/contracts` : `trend_signal` (source parmi les six de l'ADR 0060 § 2, texte, lien, format, chiffres, péremption), `content_idea` (catégorie de dépôt, à tourner, signal d'origine, raison, temps estimé, état : proposée, validée, refusée, suggérée, déposée).
- [x] Migration (prochain numéro libre à l'ouverture de la PR ; 0090 est réservée, 0091 au 03/11) : signaux, idées, motif de refus, lien idée → dépôt ; RLS de l'agence ; la créatrice ne lit rien de ces tables.
- [x] Module feuille (domaine pur) : péremption, filtres de l'ADR 0060 § 4 (dégoûts et limites, proximité sur 30 jours, refusée jamais reproposée, garde des sorties publiques, signal vivant requis).
- [x] Mesures fixées en code, en domaine pur : « trop proche » (même catégorie de dépôt et même signal d'origine, ou recouvrement des mots du titre et de « à tourner » au-dessus d'un seuil) ; « dépasse nettement la moyenne de son compte » (un facteur et un nombre minimal de posts relevés).
- [ ] Frontières : le filtre des dégoûts et limites est celui de l'ADR 0056 § 1, pris par l'`index.ts` de son module ou par une fonction pure de `packages/contracts`, jamais copié. Le module de veille n'écrit dans aucune table de l'agenda ni des dépôts : il passe par leur `index.ts` ou par un événement.
- [x] Route « coller un lien » pour l'agence et pour la créatrice : lien Instagram validé (domaine, forme), une ligne, un format, une créatrice visée ; jamais de téléchargement. **Aucune requête du serveur vers instagram.com** : le lien n'est jamais résolu (ni aperçu, ni oEmbed, ni redirection suivie) ; la route des relevés ne fait que recevoir. Les seuls appels sortants vers Meta sont ceux des API officielles (VEI-05, VEI-06).
- [x] Route d'entrée des relevés de l'extension (VEI-02) : schéma strict ; clé d'idempotence (code court du post tiré de `/p/<code>` ou `/reel/<code>`, identifiant de la session de veille tiré par l'extension) ; un post revu dans la même session met ses chiffres à jour au lieu de créer une ligne.
- [x] **Liaison extension ↔ serveur par personne**, faite depuis le CRM (« Relier l'extension ») : jeton haché, révocable, limité aux relevés ; remplace pour les relevés le jeton partagé `EXTENSION_DEVICE_TOKEN` (qui n'identifie personne) ; un relevé dit qui a regardé (RLS). À partager avec le Sync de la capture Reveal si ce lot existe déjà.
- [ ] Captures d'onglet reçues pour la vision (ADR 0060 § 2, source 6) : en mémoire seulement, quatre au plus, taille bornée ; le corps de la requête n'est jamais journalisé ; l'appel de vision compte dans le plafond de veille.
- [ ] Idée validée → suggestion de l'agenda (ADR 0042 § 4) ; suggestion acceptée → demande de contenu (ADR 0055 § 4).
- [ ] Plafond de budget propre à la veille (ADR 0060 § 7) : un usage dans `llm_calls` (`purpose` ou un `role` dédié) pour sommer la veille du jour ; un appel de veille est refusé au plafond de veille ou au plafond global ; le plafond de veille ne refuse jamais un appel de réponse au fan ; la veille compte dans les 20 €/jour et y prend au plus 1 € par défaut.
- [x] Glossaire déjà à jour (ADR 0060) ; ajouter un terme seulement si le lot en impose un.

## Critères d'acceptation
- Tests du domaine pour chaque filtre, avec une créatrice fictive.
- Tests d'intégration : RLS (la créatrice ne lit ni signal ni idée), idempotence des relevés (même post par deux chemins, même session), péremption.
- Test qui échoue si la route « coller un lien » ou la route des relevés ouvre une connexion sortante.
- Aucune donnée réelle (lien, nom de compte) dans les tests.

## Hors périmètre
La génération des idées (VEI-03), l'écran « Idées du jour » (VEI-02), le profil de contenu (VEI-04).

## Notes de session

### Découpage (accepté par la coordination le 03/11/2026)
- **a, fait** : contrats (`trends.ts`, `content-drops.ts`, `public-outputs.ts`), migration 0100 (d’abord annoncée 0098, régénérée sur 0099 après le renommage ; quatre tables et leur RLS), domaine pur (péremption, « dépasse nettement », filtres des idées), test RLS. Pas d'`index.ts` au module tant qu'il n'a ni route ni job. Fusion après #483 (0096) et #482 (0097), hors gel du renommage, migration régénérée sur le journal de `main`.
- **b, fait** : `POST /v1/trends/links` (propriétaire, membre qui n'est pas parti, créatrice pour elle seule), `/v1/trends/extension-links` (« Relier l'extension », une liaison par navigateur avec son libellé, trois au plus, jeton montré une fois et haché), `GET /v1/trends/readings/creators` et `POST /v1/trends/readings` (en-tête `x-extension-link` lu en `preParsing` sous le plafond de 30 appels par minute, sans session ni contrôle d'origine, un lot refusé entier si une marque l'est, avec les marques refusées) ; migration 0104 (FORCE ROW LEVEL SECURITY sur `trend_signals`, `trend_readings`, `content_ideas`, oublié par 0100 et relevé à la relecture de CR-05 a ; `extension_links` passe à plusieurs liaisons vivantes avec un libellé, après la relecture d'Extension) ; test qui échoue si une de ces routes ouvre une connexion sortante. Extension prévenue pour VEI-02.
- **c** : plafond de veille (`purpose` dans `llm_calls`), captures d'onglet en mémoire pour la vision.
- **d** : idée validée → suggestion de l'agenda → demande de contenu, et le lien idée → dépôt (attend CR-05 et CR-06).
- Migrations des lots b, c, d : numéro donné par la coordination à l’ouverture (0101 va à CRM-04 d3).
