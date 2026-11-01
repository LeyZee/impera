# Journal des sessions

Depuis le 16/10/2026 (soir), chaque session écrit son entrée dans son propre fichier `docs/sessions/log/<date>-<slug>.md` (format dans `docs/sessions/README.md`). **Depuis le 28/10/2026, le dossier est l’index** : une session n’ajoute plus de ligne au tableau ci-dessous, figé au 27/10, parce que ce fichier partagé faisait entrer chaque PR en conflit avec la précédente. `pnpm sessions:log` affiche les dernières entrées dans l’ordre où elles sont entrées dans le dépôt (`pnpm sessions:log --all` pour toutes) ; `scripts/check-repo.mjs` vérifie le nom et la première ligne de chaque fichier, et refuse toute ligne au-delà des 153 du tableau, quelle que soit sa date. Les entrées antérieures au 16/10 (soir) restent en bas de ce fichier, figées.

## Index (figé au 27/10/2026)

| Date | Fiche | Statut | Entrée |
|---|---|---|---|
| 2026-10-16 | Revue des fondations (Fable) | done | `log/2026-10-16-fondations-revue.md` |
| 2026-10-16 | Logo et marque (Fable) | done | `log/2026-10-16-logo.md` |
| 2026-10-16 | Revue indépendante (Opus) | done | `log/2026-10-16-revue-independante.md` |
| 2026-10-17 | Brainstorm interface, extension, playground (Opus) | done | `log/2026-10-17-interface-brainstorm.md` |
| 2026-10-17 | P0-01 Outillage du monorepo (Opus) | done (PR #14) | `log/2026-10-17-p0-01.md` |
| 2026-10-17 | P3-01 Passerelle LLM, Grok 4.7 et playground (Opus) | in_progress | `log/2026-10-17-p3-01.md` |
| 2026-10-17 | P0-08 Schéma de persona calqué sur OnlyChat | done (PR #17) | `log/2026-10-17-p0-08.md` |
| 2026-10-17 | Vocaux générés, conception (Opus) | proposed | `log/2026-10-17-vocaux.md` |
| 2026-10-17 | Connexion Reveal : inventaire, capture, FakeReveal (Opus) | done | `log/2026-10-17-reveal-connexion.md` |
| 2026-10-17 | ADR 0018 port connecteur étendu (Opus) | done | `log/2026-10-17-adr-0018.md` |
| 2026-10-27 | FakeReveal et capture express (Opus) | done | `log/2026-10-27-fake-reveal.md` |
| 2026-10-17 | P3-03 Connexion des services IA, conception (Opus) | done | `log/2026-10-17-p3-03-conception.md` |
| 2026-10-17 | P3-03 Connexion des services IA, module `providers` (Opus) | done (PR #27) | `log/2026-10-17-p3-03.md` |
| 2026-10-17 | P3-03 Corrections de la recette des clés IA (Opus) | in_progress (PR #58) | `log/2026-10-17-p3-03-recette.md` |
| 2026-10-17 | README à jour et design system en images | done | `log/2026-10-17-readme-design.md` |
| 2026-10-17 | P3-04 Vision des médias et pièges (Opus) | in_progress | `log/2026-10-17-p3-04.md` |
| 2026-10-17 | Coquille du dashboard et écran Playground (Opus) | done (PR #34) | `log/2026-10-17-web-coquille-playground.md` |
| 2026-10-17 | P0-02 Contrats partagés | done | `log/2026-10-17-p0-02.md` |
| 2026-10-17 | P0-03 Base de données | done | `log/2026-10-17-p0-03.md` |
| 2026-10-17 | P0-04 Serveur et worker | done | `log/2026-10-17-p0-04.md` |
| 2026-10-17 | P3-05 Boucle de calibrage dans le playground (Opus) | in_progress | `log/2026-10-17-p3-05.md` |
| 2026-10-17 | P3-06 API du playground (Opus) | in_progress | `log/2026-10-17-p3-06.md` |
| 2026-10-17 | Politique de vente du corpus, ID proposé (Opus) | in_progress | `log/2026-10-17-sales-policy.md` |
| 2026-10-17 | P0-07a Login du dashboard | done | `log/2026-10-17-p0-07a.md` |
| 2026-10-17 | P0-05 Module conversations | done | `log/2026-10-17-p0-05.md` |
| 2026-10-17 | P0-06 Module connectors | done | `log/2026-10-17-p0-06.md` |
| 2026-10-17 | P0-05 suite : port du moteur et journal `llm_calls` | done | `log/2026-10-17-p0-05-composer.md` |
| 2026-10-17 | P0-07b CI, scripts ops, bout en bout : phase 0 acceptée | done | `log/2026-10-17-p0-07b.md` |
| 2026-10-17 | Redemande du mot de passe avant une clé IA (ADR 0016) | done | `log/2026-10-17-reauth.md` |
| 2026-10-17 | Créatrices : liste et création | done | `log/2026-10-17-creators.md` |
| 2026-10-17 | Garde-fou local contre les push sur `main` | done | `log/2026-10-17-protect-main.md` |
| 2026-10-17 | Table des notes d'entraînement (`calibration_ratings`) | done | `log/2026-10-17-calibration-table.md` |
| 2026-10-17 | Fiches proposées : alertes de nuit, copilote côté API | done | `log/2026-10-17-fiches-alertes-copilote.md` |
| 2026-10-17 | Démarrage sous Windows : fins de ligne et clés vides | done | `log/2026-10-17-windows.md` |
| 2026-10-17 | Contrats pour les alertes (cause de passage à un humain, budget, reprise) | done | `log/2026-10-17-alert-contracts.md` |
| 2026-10-17 | Persona : genre déprécié | done | `log/2026-10-17-persona-gender.md` |
| 2026-10-17 | `owner:create` ne montre plus le mot de passe | done | `log/2026-10-17-owner-password.md` |
| 2026-10-17 | `takeover_started` nomme sa conversation | done | `log/2026-10-17-takeover-conversation.md` |
| 2026-10-17 | L'arrêt d'urgence bloque l'approbation et l'envoi | done | `log/2026-10-17-kill-switch-send.md` |
| 2026-10-17 | Jobs bornés, échec définitif visible | done | `log/2026-10-17-jobs-bounded.md` |
| 2026-10-17 | Branchement du module Telegram | done | `log/2026-10-17-telegram-wiring.md` |
| 2026-10-17 | Modèle injoignable : la main passe à un humain | done | `log/2026-10-17-llm-unavailable-handoff.md` |
| 2026-10-17 | Dashboard, PR 1 : pièces du design system | done | `log/2026-10-17-dashboard-ds.md` |
| 2026-10-17 | Alertes Telegram : ADR 0020, fiche P3-07, maquette | done | `log/2026-10-17-alertes-telegram.md` |
| 2026-10-17 | Suivi, squelette : liste des conversations (P0-07b, côté web) | done (PR #42) | `log/2026-10-17-web-suivi-squelette.md` |
| 2026-10-17 | Écran Persona du CRM, dans Créatrices (Opus) | in_progress | `log/2026-10-17-persona-screen.md` |
| 2026-10-17 | P3-07 lot 1 : moteur des notifications Telegram | done (PR #59) | `log/2026-10-17-telegram-lot1.md` |
| 2026-10-17 | P3-07 lot 2 : page Réglages › Telegram | done (PR #70) | `log/2026-10-17-telegram-lot2.md` |
| 2026-10-19 | P3-07 : bandeau Telegram sur le Dashboard | done (PR #80) | `log/2026-10-19-telegram-dashboard-banner.md` |
| 2026-10-19 | P3-07 : alerte Telegram « Automatique refermé » | done (PR #93) | `log/2026-10-19-telegram-automatic-closed.md` |
| 2026-10-17 | Dashboard, PR 2 : coquille sur données d'exemple | done (PR #55) | `log/2026-10-17-dashboard-shell.md` |
| 2026-10-17 | Audit des champs de la persona (Opus) | in_progress | `log/2026-10-17-persona-audit.md` |
| 2026-10-17 | Contrôle de l'agent partagé, pastille de la barre | done | `log/2026-10-17-web-controle-agent.md` |
| 2026-10-17 | Dashboard : focus après la confirmation d'arrêt | done | `log/2026-10-17-dashboard-focus.md` |
| 2026-10-17 | Gardes de sortie, relances et plafond (revue 09) (Opus) | in_progress | `log/2026-10-17-gardes-revue-09.md` |
| 2026-10-17 | Tests d'écran d'apps/web (G15) | done | `log/2026-10-17-web-tests-ecran.md` |
| 2026-10-17 | Clés Mistral et Venice en développement, message des clés de chiffrement | done | `log/2026-10-17-mistral-env-keys.md` |
| 2026-10-17 | API du Dashboard, GET /v1/dashboard (Opus) | in_progress | `log/2026-10-17-dashboard-api.md` |

## Incidents (liste vivante)

_Aucun pour l'instant._

## Candidats à suppression (liste vivante)

_Aucun pour l'instant._

---

## 2026-10-16 — Phase 0 : fondations documentaires — done (Fable 5.1, architecte)

Fait : structure du dépôt, `CLAUDE.md`, docs d'architecture, ADR 0001 à 0014, conventions (code, tests, git, sécurité, hygiène), glossaire, playbooks, références (OnlyChat, projets hérités, vocabulaire média, schéma persona, gabarit API Reveal), roadmap, fiches P0-01 à P0-07 et P1-01 à P1-03, configs racine (pnpm, turbo, tsconfig, eslint boundaries, prettier, lefthook, CI, PR template).
Pas fait : aucun code applicatif (volontaire : P0-01 à P0-07). `pnpm install` non exécuté ici.
Décisions : voir `docs/adr/`.
Découvertes : le dépôt Imperium contient des secrets committés (signalé à Charles le 16/10).
Candidats à suppression : aucun.
Vérifié : relecture des docs ✓. Pas de code à tester.

## 2026-10-16 (soir) — Dépôt à la racine du projet, README visuel, brief design — Fable (architecture)

- Le dépôt git est désormais la racine de `Projet Nirvana/` (demande de Charles) ; le sous-dossier `nirvana/` a été supprimé. `brainstorm/` et le cahier des charges sont suivis par git comme historique, protégés par `hygiene.md`.
- README réécrit (bannière, badges, diagrammes Mermaid, structure, méthode, pile, sécurité, roadmap, qui).
- Brief design `docs/design/brief.md` (Liquid Glass iOS 26/27) et fiche `D-01`.
- Dépôt GitHub `LeyZee/nirvana` créé (privé, branche `main`) depuis le PC de Charles avec son compte, et rattaché au projet. GitHub est désormais la source de vérité ; le dossier du projet et le dossier local de Charles en sont deux clones.

## 2026-10-16 (nuit) — D-01 Design system « Liquid Glass » — in_progress (Opus 5.5)

Fait : `packages/design-system` (tokens Nuit/Jour, pont Tailwind v4, classes `nv-*`, aides d'animation, test de contraste AA), guide `docs/design/README.md`, renvois mis à jour (README, CLAUDE.md, START-HERE, apps/web, apps/extension, brief).
Pas fait : composants shadcn/ui restylés, `_playground.tsx`, test axe-core : bloqués par P0-01 (apps non initialisées).
Décisions : réponses de Charles au brief (identité propre, néon rouge sur nuit, en code) ; ADR 0015 proposée (package partagé web + extension) ; règle de frontière `app → package design-system` ajoutée dans `eslint.config.js`.
Découvertes : la palette de l'ancienne bannière (violet, cyan) ne correspond plus à la direction choisie ; la bannière est à refaire quand un logo existera.
Candidats à suppression : aucun.
Vérifié : typecheck strict ✓ et tests Vitest ✓ (27) via un outillage jetable dans `.scratch/` ; rendu des deux thèmes vérifié dans le navigateur. `pnpm check` non exécutable avant P0-01 (pas de `pnpm install`).
Suite : l'artifact de référence (lien dans `docs/design/README.md`) est aligné sur le dépôt (tokens, vocabulaire du glossaire, DraftPanel et ExtensionPopup à la place du panneau d'extension) ; `.nv-aura` reçoit `contain: paint` pour que ses halos ne débordent pas du `body`.
Découvertes (CI, PR #1) : la CI est rouge sur `main` comme sur la PR, pour deux causes antérieures à D-01. (1) `check`, `test` et `audit` s'arrêtent à `actions/setup-node` (`cache: pnpm`) faute de `pnpm-lock.yaml` : relève de P0-01. (2) `gitleaks/gitleaks-action@v2` reçoit un 403 en listant les commits de la PR, car le workflow n'accorde que `contents: read` ; il lui faut aussi `pull-requests: read`. Relève de P0-07, non corrigé ici.
| 2026-10-18 | Les médias du fan dans l'historique du moteur (B2) | done | `log/2026-10-18-history-media.md` |
| 2026-10-17 | Identifiants UUID v7 pour llm_calls et kill_switches | done | `log/2026-10-17-uuid-v7-rows.md` |
| 2026-10-18 | Règle d'évolution des payloads du journal (G13) | done | `log/2026-10-18-event-upcast.md` |
| 2026-10-19 | Route du mode de l'agent : Arrêt et Copilote depuis le CRM | done | `log/2026-10-19-agent-mode-route.md` |
| 2026-10-19 | Vision sur tout média avant le brouillon (Opus) | done | `log/2026-10-19-vision-tout-media.md` |
| 2026-10-18 | Fiche de conversation lue d'un seul instant (G4) | done | `log/2026-10-18-snapshot-read.md` |
| 2026-10-19 | `globalStop` dans GET /v1/dashboard | done | `log/2026-10-19-dashboard-global-stop.md` |
| 2026-10-19 | Le Dashboard et la barre lisent GET /v1/dashboard | done | `log/2026-10-19-web-dashboard-reel.md` |
| 2026-10-19 | Le contrôle du Dashboard change vraiment le mode | done | `log/2026-10-19-web-mode-ecriture.md` |
| 2026-10-19 | Serveur muet au chargement : plus d'écran de connexion à tort | done | `log/2026-10-19-web-serveur-muet-connexion.md` |
| 2026-10-19 | Textes du CRM relevés par la recette | done | `log/2026-10-19-web-textes-recette.md` |
| 2026-10-22 | Suivi : file « à traiter », lecteur et décisions sur les brouillons | done | `log/2026-10-22-web-suivi-lecteur.md` |
| 2026-10-22 | Playground : le message reste quand l'envoi échoue (recette R-G12) | done | `log/2026-10-22-web-playground-message-garde.md` |
| 2026-10-22 | Extension : icônes, paquet zip, marge du popup (recette) | done | `log/2026-10-22-extension-icones-popup.md` |
| 2026-10-22 | Suivi : `reader.ts` renommé, typecheck sous Windows et macOS | done | `log/2026-10-22-web-suivi-casse.md` |
| 2026-10-22 | Playground : « Clé manquante » dès l’ouverture, coûts en euros | done | `log/2026-10-22-web-playground-euros.md` |
| 2026-10-23 | Suivi : une note à l’agent en rendant la main | done | `log/2026-10-23-web-suivi-note-release.md` |
| 2026-10-23 | Suivi : les limites du fan, lues et changées dans le lecteur | done | `log/2026-10-23-web-suivi-drapeaux.md` |
| 2026-10-23 | Suivi : le résumé des limites commence par une majuscule | done | `log/2026-10-23-web-suivi-drapeaux-majuscule.md` |
| 2026-10-19 | Références plateforme du composeur pour la vision | done | `log/2026-10-19-compose-platform-refs.md` |
| 2026-10-19 | IP réelle derrière le proxy, limite de connexion par compte (G6) | done | `log/2026-10-19-trust-proxy.md` |
| 2026-10-19 | Verrou serveur de l'Automatique (B3) | done | `log/2026-10-19-automatic-lock.md` |
| 2026-10-19 | Le Dashboard affiche le taux lu par le verrou | done | `log/2026-10-19-dashboard-lock-rate.md` |
| 2026-10-19 | Gardes dures à l'approbation (G5) | done | `log/2026-10-19-approval-guard.md` |
| 2026-10-19 | Commandes mortes vérifiées par check-repo (G14) | done | `log/2026-10-19-delegated-scripts.md` |
| 2026-10-19 | Interrupteur global hors d'atteinte des créatrices (G16) | done | `log/2026-10-19-kill-switch-rls.md` |
| 2026-10-19 | ADR 0015 et 0018 acceptées (G16) | done | `log/2026-10-19-adr-status.md` |
| 2026-10-19 | Dashboard : phrase des urgences, sous-titre, lecteur | done | `log/2026-10-19-dashboard-details.md` |
| 2026-10-19 | Clés IA : texte vrai quand la vérification échoue (quota ou panne) | done | `log/2026-10-19-cles-texte-injoignable.md` |
| 2026-10-19 | Telegram : alerte de remise à l'humain fermée au retour à l'agent (recette R-G4) | done | `log/2026-10-19-telegram-takeover-ended.md` |
| 2026-10-19 | Réglages › Telegram : « Le serveur ne répond pas » (recette R-C2) | done | `log/2026-10-19-telegram-server-down-text.md` |
| 2026-10-22 | Telegram : alerte quand un message de l'agent ne part pas (recette R-G5) | done | `log/2026-10-22-telegram-send-failed.md` |
| 2026-10-19 | identity_policy retiré, rester en personnage fixé dans le code (ADR 0021) | done | `log/2026-10-19-remove-identity-policy.md` |
| 2026-10-19 | Dashboard : clé manquante et jobs bloqués (R-G6) | done | `log/2026-10-19-dashboard-health.md` |
| 2026-10-22 | Réponse au fan qui a écrit pendant un Arrêt (R-G2) | done | `log/2026-10-22-resume-after-stop.md` |
| 2026-10-19 | Persona : textes de la recette (A-13, A-14) | done | `log/2026-10-19-persona-recette.md` |
| 2026-10-19 | Dashboard : Reveal jamais relié en neutre, info-bulle d'Automatique | done | `log/2026-10-19-dashboard-not-outages.md` |
| 2026-10-22 | Dashboard : clé manquante en ambre, tâches bloquées, « À valider » ouvre Suivi | done | `log/2026-10-22-dashboard-key-missing.md` |
| 2026-10-19 | Gardes de sortie : contournements de la recette (R-G1) | done | `log/2026-10-19-guards-acceptance.md` |
| 2026-10-22 | Dashboard : chaque ligne de « À traiter » ouvre Suivi | done | `log/2026-10-22-dashboard-todos-to-suivi.md` |
| 2026-10-22 | Créatrices : créer une créatrice, activer une version | done | `log/2026-10-22-persona-creer-activer.md` |
| 2026-10-19 | Refonte du design system : jetons et composants (D-01) | done | `log/2026-10-19-d-01-refonte.md` |
| 2026-10-22 | Dashboard : part agent des Meilleurs fans en couleur de données (A-11) | done | `log/2026-10-22-dashboard-top-fans-data.md` |
| 2026-10-22 | Alertes Telegram : prise en main après une remise, takeover_ended et send_failed publiés (R-G4) | done | `log/2026-10-22-telegram-events.md` |
| 2026-10-22 | CI : installation de ffmpeg bornée et réessayée | done | `log/2026-10-22-ci-ffmpeg-timeout.md` |
| 2026-10-22 | Refonte du design system : coquille et Dashboard (D-01) | done | `log/2026-10-22-d-01-coquille-dashboard.md` |
| 2026-10-22 | Dashboard : envoi échoué pour de bon dans À traiter (R-G5) | done | `log/2026-10-22-dashboard-send-failed.md` |
| 2026-10-22 | Playground : voix joignable et coûts en euros dans l'état | done | `log/2026-10-22-playground-state-euros.md` |
| 2026-10-22 | Dashboard : prénom inventé pour un fan de l’exemple (ADR 0010) | done | `log/2026-10-22-dashboard-sample-names.md` |
| 2026-10-22 | CI : paquets de ffmpeg en cache, installés sans réseau | done | `log/2026-10-22-ci-ffmpeg-cache.md` |
| 2026-10-22 | Telegram : alertes vérifiées de bout en bout (conversations → Telegram) | done | `log/2026-10-22-telegram-alerts-e2e.md` |
| 2026-10-22 | Dashboard : jobs sans tâche du worker comptés comme bloqués (suite de R-G6) | done | `log/2026-10-22-orphan-jobs.md` |
| 2026-10-22 | ffmpeg vérifié au démarrage, messages clairs | done | `log/2026-10-22-ffmpeg-check.md` |
| 2026-10-22 | ai-engine.md : « tu es un bot ? » renvoie à ADR 0021 | done | `log/2026-10-22-ai-engine-adr-0021.md` |
| 2026-10-22 | Automatique : la persona active fait partie de la version prouvée (R-G3, ADR 0022) | done | `log/2026-10-22-automatic-persona.md` |
| 2026-10-22 | Playground : le contrat ne donne plus que des euros | done | `log/2026-10-22-playground-usd-out.md` |
| 2026-10-23 | Mémoire du fan : le module `fans` écrit et lit les faits (P3-02, PR 1) | done | `log/2026-10-23-fan-facts.md` |
| 2026-10-23 | Mémoire du fan : contrats des slots KYC et des drapeaux (P3-02, PR 2) | done | `log/2026-10-23-fan-contracts.md` |
| 2026-10-23 | Politique de vente : les drapeaux du fan passent avant tout (P3-02, PR 4a) | done | `log/2026-10-23-policy-fan-flags.md` |
| 2026-10-23 | Refonte du design system : onglet Créatrices (D-01) | done | `log/2026-10-23-d-01-creatrices.md` |
| 2026-10-23 | Mémoire du fan : purge des faits un an après le dernier contact (P3-02, PR 4b) | done | `log/2026-10-23-fan-facts-purge.md` |
| 2026-10-23 | Mémoire du fan : les faits du brief deviennent des faits à l’approbation, note du chatteur (P3-02, PR 3) | done | `log/2026-10-23-fan-facts-conversations.md` |
| 2026-10-23 | Refonte du design system : lueur, ressort unique, thème Jour (D-01) | done | `log/2026-10-23-d-01-lueur-ressort-jour.md` |
| 2026-10-23 | Refonte : onglet Entraîner (D-01) | done | `log/2026-10-23-d-01-entrainer.md` |
| 2026-10-23 | Refonte : onglet Suivi (D-01) | done | `log/2026-10-23-d-01-suivi.md` |
| 2026-10-23 | Refonte : onglet Réglages (D-01) | done | `log/2026-10-23-d-01-reglages.md` |
| 2026-10-23 | Refonte : connexion (D-01) | done | `log/2026-10-23-d-01-connexion.md` |
| 2026-10-23 | Mémoire du fan : poser et lever les limites d’un fan (P3-02, PR 4c) | done | `log/2026-10-23-fan-flags.md` |
| 2026-10-23 | Mémoire du fan : routes des drapeaux pour l’humain (P3-02, PR 5) | done | `log/2026-10-23-fan-flags-routes.md` |
| 2026-10-23 | Mémoire du fan : la politique pose les drapeaux sur un risque (P3-02, PR 6) | done | `log/2026-10-23-fan-flags-policy.md` |
| 2026-10-25 | security.md : les compteurs des limites de débit vivent en mémoire | done | `log/2026-10-25-security-limiter-memory.md` |
| 2026-10-25 | modules.md à l’état de main, tarifs du playbook dans catalog.ts | done | `log/2026-10-25-docs-modules-state.md` |
| 2026-10-25 | Refonte : images du guide refaites depuis le CRM (D-01) | done | `log/2026-10-25-d-01-images-guide.md` |
| 2026-10-25 | Refonte : Réglages › Apparence, Nuit / Jour / Appareil (D-01) | done | `log/2026-10-25-d-01-apparence.md` |
| 2026-10-25 | Reprise après un Arrêt : les réponses dues partent l’une après l’autre | done | `log/2026-10-25-resume-spacing.md` |
| 2026-10-25 | Refonte : passe téléphone du Playground, taux en un seul ton (D-01) | done | `log/2026-10-25-d-01-telephone.md` |
| 2026-10-27 | Gestion d'équipe : ADR 0023 (acceptée) et fiches des lots 1 à 5 | done | `log/2026-10-27-adr-0023-equipe.md` |
| 2026-10-27 | Équipe : fiches EQ-01 à EQ-09, pays et préréglages, import facultatif | done | `log/2026-10-27-eq-fiches.md` |
| 2026-10-27 | Équipe : ADR 0024 (rôles et navigation), connexion du chatteur, shell par rôle | done | `log/2026-10-27-adr-0024-roles.md` |
| 2026-10-27 | EQ-01 : base de l’équipe, `withMember` et RLS par compte | done | `log/2026-10-27-eq-01-team-base.md` |
| 2026-10-27 | EQ-01 : rôle d’équipe et scope dans `/v1/me` | done | `log/2026-10-27-eq-01-me-team-role.md` |
| 2026-10-27 | Serveur MCP : ADR 0026 (acceptée) et fiches des quatre lots | done | `log/2026-10-27-adr-0026-mcp.md` |
| 2026-10-27 | Drapeaux du fan : la créatrice ne les lit plus (ADR 0023) | done | `log/2026-10-27-fan-flags-creator-role.md` |
| 2026-10-27 | Équipe : les trous et l’utile d’Imperium en fiches (EQ-12 à EQ-19), chatteurs seuls à vendre au lancement | done | `log/2026-10-27-eq-trous.md` |
| 2026-10-27 | EQ-11 : shell par rôle, rail, « Plus » et gardes de route | done | `log/2026-10-27-eq-11-role-based-shell.md` |
| 2026-10-27 | Conversations routées : un chatteur n’atteint que les siennes (prérequis EQ-08, EQ-10) | done | `log/2026-10-27-routed-conversations.md` |
| 2026-10-27 | Conversations fermées au rôle creator, même les siennes (ADR 0023) | done | `log/2026-10-27-creator-off-conversations.md` |
| 2026-10-27 | Suivi fermé à la créatrice (ADR 0023) | done | `log/2026-10-27-web-suivi-sans-creatrice.md` |
| 2026-10-27 | Dashboard : la créatrice ne voit que ses agrégats (ADR 0023) | done | `log/2026-10-27-dashboard-creator-view.md` |
| 2026-10-27 | Modules vides sales et scripts retirés (audit du 27/10) | done | `log/2026-10-27-remove-empty-modules.md` |
| 2026-10-27 | Évaluations : 34 scénarios et exécuteur sur le vrai chemin de l’agent | done | `log/2026-10-27-evals-runner.md` |
| 2026-10-27 | Migration 0017 : table du limiteur partagé (OPS-01) | done | `log/2026-10-27-rate-limit-table.md` |
| 2026-10-27 | OPS-01 Mise en production, lot 1 : images Docker (Opus) | in_progress | `log/2026-10-27-ops-01-images.md` |
| 2026-10-27 | Pièges : batterie d’injection (langues, encodages, médias, notes, messages coupés) | done | `log/2026-10-27-injection-battery.md` |
| 2026-10-27 | EQ-01 et EQ-10 : contrats des membres et des liens d’invitation | done | `log/2026-10-27-eq-01-eq-10-contracts.md` |
