# Roadmap

Dernière revue : 2026-10-17 (vente avancée en phase 3, Grok 4.7, plus d'Inbox). Chaque phase a un critère d'acceptation vérifiable ; on ne passe pas à la suivante sans. Les fiches de tâches sont dans `sessions/tasks/`.

| Phase | Nom | Critère d'acceptation | Fiches |
|---|---|---|---|
| **0** | Fondations | `pnpm check` et `pnpm test` verts en CI sur un squelette où chaque module existe ; un message injecté via `FakeConnector` produit un événement `message_received` et un draft vide ; RLS prouvée par un test | P0-01 → P0-07b |
| **1** | Spike Reveal | `reveal-api-observed.md` répond aux 14 questions ; FakeReveal reproduit les endpoints ; décision B/C écrite (ADR 0008 confirmée ou nouvelle ADR) | P1-01 → P1-03 |
| **2** | Connecteur Reveal en production, lecture seule puis envoi manuel | Les conversations Reveal s'affichent dans le dashboard en temps quasi réel (p95 < 60 s) ; un envoi manuel depuis le dashboard est vérifié ; session chiffrée ; kill switch ; réconciliation ; runbooks testés | P2-xx |
| **3** | Moteur IA en copilote, vente comprise | Chaque message entrant produit un draft avec brief, politique et gardes tracés ; le premier agent vend déjà : scripts Reveal déroulés, jamais deux fois le même script au même fan, prix fixes sans négociation, aftercare (`/mnt/project-files/chatting/methode-chatting.md`) ; test express et évals `smoke` verts ; Grok 4.7 vs Mistral comparés ; notes fan alimentées ; playground (P3-01) | P3-01 → P3-xx |
| **4** | Supervision | Dashboard (stats façon Reveal), Entraîner (Playground, Corrections, Tests, Comparer), Suivi (« Envoyées sans retouche »), panneau « Modèles IA » (santé, coûts, budget), validation des propositions dans le panneau latéral de l'extension, prise en main, notifications | P4-xx |
| **5** | Mode auto progressif + PWA | Catégories auto-approuvées, horaires de vie, relances ; PWA mobile pour Messa (notifications de ventes et à-faire) ; éditeur de persona | P5-xx |
| **6** | Commerce avancé | Catalogue de médias décrits par `sense`, customs, pourboires, envois de masse, attribution bot/chatteurs, reporting des ventes. La vente de base est en phase 3 | P6-xx |
| **7** | Instagram | Agent de veille et d'idées de reels avec apprentissage accepter/refuser ; réponses aux commentaires ; publication | P7-xx |
| **8** | Plateforme propre | `apps/platform`, `NirvanaPlatformConnector` in-process, paiements, conformité ; voir `architecture/own-platform.md` | P8-xx |

Équipe (ADR 0023 et 0024, acceptées le 27/10) : la gestion de l'équipe reprise d'Imperium, avec ses règles inchangées, avance en parallèle des phases, car elle n'attend ni les clés ni la capture Reveal : membres et shell par rôle → connexion des chatteurs → planning, annonces et notifications → rapports de fin de shift, paie, factures des prestataires → journal, double authentification, départ, accès borné au shift, « Voir comme » → mise en service de la paie (sauvegardes, comptable, paie à blanc) ; l'entraînement des recrues attend les clés comme le playground ; l'import de l'historique d'Imperium est facultatif (pas de base) ; le mode hybride (passage à l'humain pour vendre) suit la capture, avec les chatteurs seuls à vendre au lancement ; la PWA de la créatrice est la phase 5, en second temps, comme les scripts.

Transversal : sessions d'hygiène `H-xx` toutes les ~10 tâches ; revue du modèle de menaces à chaque phase ; test de restauration trimestriel ; rotation des secrets semestrielle.

## Ce qui dépend de Charles

- Accès créatrice Reveal (phase 1).
- Lecture des CGU Reveal sur l'automatisation (phase 1, décision B/C).
- Dépôt GitHub privé `LeyZee/nirvana` créé le 16/10/2026 ; rotation des secrets Imperium en attente de Charles.
- Clés API xAI, Mistral (phase 3).
- Persona réelle de Messalina hors dépôt (phase 3).
- Compte Neon, VPS Hetzner, Cloudflare (phase 2).
