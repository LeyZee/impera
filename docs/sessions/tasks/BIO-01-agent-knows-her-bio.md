# BIO-01 L'IA connaît la bio de la créatrice sur la plateforme
Statut : done
Phase : agent (ADR 0154, ADR 0110)
Dépend de : ADR 0154 (acceptée le 20/11/2026) ; lecture du profil `models.get` (déjà observée)
Branche : claude/project-thread-4038gn
Propriétaire : fil « Donner la bio Reveal à l'IA » ; relecteurs Agent (agent, llm, playground) et Bilan (connecteur, base)

## Objectif (1 phrase)

Un fan qui fait allusion à la bio de la créatrice trouve une IA qui la connaît, ne la contredit pas et peut jouer avec.

## Fait

- Port des connecteurs : `getCreatorProfile` derrière la capacité `creatorProfile` ; Reveal lit `description` de `models.get`, en lecture seule ; FakeReveal sert une bio réglable.
- Poll : la bio est relue au plus toutes les 15 minutes, gardée sur `platform_accounts` (`profile_bio`, `profile_bio_read_at`, migration 0237) ; une lecture ratée garde la précédente, une session expirée arrête le poll comme ailleurs.
- Agent : la bio est lue à chaque brouillon (`profileBioOf`), filtrée ligne par ligne contre l'injection, donnée au cerveau, à la voix et au juge dans un bloc `<profile_bio>` coupé à 2 000 caractères ; elle prime sur la fiche (prompts brain 1.21.0, voice 1.13.0, judge 1.2.0).
- Playground : la version d'une créatrice jouée lit la même bio ; la persona inventée n'en a pas.
- Évaluations : champ `profile_bio` des scénarios, scénario fictif `bio-allusion` (non lancé : appel payant).

## Reste

- Lancer le scénario `bio-allusion` (payant, avec l'accord de Charles).
- Vérifier sur le PC, au premier poll réel, que `description` porte bien la bio affichée (sans recopier son texte).
