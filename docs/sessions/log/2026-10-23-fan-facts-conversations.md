# 2026-10-23 · Mémoire du fan, côté conversations (P3-02, PR 3)

Fait : les faits que le brief lit dans les messages du fan restent sur le brouillon (`drafts.brief`), datés par le message où ils ont été lus. Quand un humain approuve le brouillon, le job `conversation.record_facts` les fait écrire par le module `fans` (`proposeFacts`) et écrit un `fact_confirmed` par fait nouveau. La note d'un chatteur en rendant la main (`POST …/release`, `note`, 300 caractères) devient un fait `operator_note`, lu par le moteur comme « Note : … ». Migration 0014 : catégorie `operator_note`, et types d'événement `fan_flag_set` / `fan_flag_cleared` (contrat `fanFlagPayload`) pour que l'agent code `setFlag` / `clearFlag`. Le moteur reçoit ses faits par `fans.activeFacts` (triés, 40 au plus) au lieu d'une lecture directe de `fan_facts`. L'adaptateur de l'agent transmet `factsProposed` du brief.

Pas fait : le mode automatique n'écrit pas encore de faits (aucun brouillon n'y part sans humain aujourd'hui) ; le champ « note » dans l'écran Suivi (Extension).

Décisions : une catégorie inconnue du brief est ignorée, `operator_note` n'est jamais acceptée d'un modèle ; un brouillon refusé n'écrit aucun fait ; une note par clé datée, les notes s'ajoutent ; l'écriture passe par un job pour que l'envoi n'attende jamais la mémoire.

Relectures : agent (adaptateur `draft-composer.ts`, usage de `fans`).

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration (Testcontainers).
