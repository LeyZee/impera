# VEI-01 Signaux de tendance et idées de contenu : la base, les filtres, le lien collé
Statut : todo
Phase : veille (ADR 0060)
Dépend de : CR-05 (suggestions de l'agenda), CR-06 (demande de contenu)
Branche : task/vei-01-trend-signals
Propriétaire : Bilan (contrats, base, module, routes)

## Objectif
Les signaux de tendance et les idées de contenu existent en base, avec les filtres du code, et un membre de l'agence peut déjà coller un lien repéré sur Instagram.

## Contexte à lire
ADR 0060 (tout), ADR 0042 § 4, ADR 0055 § 1 et § 4, ADR 0056 § 1 (filtre des dégoûts), ADR 0057 § 6 (garde Instagram), ADR 0010.

## À faire
- [ ] Contrats Zod dans `packages/contracts` : `trend_signal` (source parmi les six de l'ADR 0060 § 2, texte, lien, format, chiffres, péremption), `content_idea` (catégorie de dépôt, à tourner, signal d'origine, raison, temps estimé, état : proposée, validée, refusée, suggérée, déposée).
- [ ] Migration (prochain numéro libre à l'ouverture de la PR ; 0090 est réservée, 0091 au 03/11) : signaux, idées, motif de refus, lien idée → dépôt ; RLS de l'agence ; la créatrice ne lit rien de ces tables.
- [ ] Module feuille (domaine pur) : péremption, filtres de l'ADR 0060 § 4 (dégoûts et limites, proximité sur 30 jours, refusée jamais reproposée, garde des sorties publiques, signal vivant requis).
- [ ] Mesures fixées en code, en domaine pur : « trop proche » (même catégorie de dépôt et même signal d'origine, ou recouvrement des mots du titre et de « à tourner » au-dessus d'un seuil) ; « dépasse nettement la moyenne de son compte » (un facteur et un nombre minimal de posts relevés).
- [ ] Frontières : le filtre des dégoûts et limites est celui de l'ADR 0056 § 1, pris par l'`index.ts` de son module ou par une fonction pure de `packages/contracts`, jamais copié. Le module de veille n'écrit dans aucune table de l'agenda ni des dépôts : il passe par leur `index.ts` ou par un événement.
- [ ] Route « coller un lien » pour l'agence et pour la créatrice : lien Instagram validé (domaine, forme), une ligne, un format, une créatrice visée ; jamais de téléchargement. **Aucune requête du serveur vers instagram.com** : le lien n'est jamais résolu (ni aperçu, ni oEmbed, ni redirection suivie) ; la route des relevés ne fait que recevoir. Les seuls appels sortants vers Meta sont ceux des API officielles (VEI-05, VEI-06).
- [ ] Route d'entrée des relevés de l'extension (VEI-02) : schéma strict ; clé d'idempotence (code court du post tiré de `/p/<code>` ou `/reel/<code>`, identifiant de la session de veille tiré par l'extension) ; un post revu dans la même session met ses chiffres à jour au lieu de créer une ligne.
- [ ] Idée validée → suggestion de l'agenda (ADR 0042 § 4) ; suggestion acceptée → demande de contenu (ADR 0055 § 4).
- [ ] Plafond de budget propre à la veille (ADR 0060 § 7) : un usage dans `llm_calls` (`purpose` ou un `role` dédié) pour sommer la veille du jour ; un appel de veille est refusé au plafond de veille ou au plafond global ; le plafond de veille ne refuse jamais un appel de réponse au fan ; la veille compte dans les 20 €/jour et y prend au plus 1 € par défaut.
- [ ] Glossaire déjà à jour (ADR 0060) ; ajouter un terme seulement si le lot en impose un.

## Critères d'acceptation
- Tests du domaine pour chaque filtre, avec une créatrice fictive.
- Tests d'intégration : RLS (la créatrice ne lit ni signal ni idée), idempotence des relevés (même post par deux chemins, même session), péremption.
- Test qui échoue si la route « coller un lien » ou la route des relevés ouvre une connexion sortante.
- Aucune donnée réelle (lien, nom de compte) dans les tests.

## Hors périmètre
La génération des idées (VEI-03), l'écran « Idées du jour » (VEI-02), le profil de contenu (VEI-04).

## Notes de session
