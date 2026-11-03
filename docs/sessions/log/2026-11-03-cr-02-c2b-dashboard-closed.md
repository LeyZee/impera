# 2026-11-03 — CR-02 lot c2b : le Dashboard fermé à la créatrice — done
Fait : `GET /v1/dashboard` réservé au propriétaire et à l'opérateur (`requireRole('owner', 'operator')`), la créatrice reçoit 403 ; les masques qui ne servaient qu'à elle sont retirés côté serveur (ventes Reveal lues pour tous les lecteurs restants) ; côté web, `forCreator` disparaît de `heroState`, `foldOf`, `live.ts`, `DashboardPage`, `AgentHero` et du routeur, avec la pastille de mode `.db-modepill` ; tests d'intégration (403 créatrice) et tests web mis à jour ; fiche CR-02.
Décisions : elle lit sa journée dans son Aujourd'hui (lot c2), jamais l'état de l'agent (ADR 0042 § 8, ADR 0023) ; rien de ce qu'elle voyait ne reste à masquer.
Pas fait : Ventes › Fans et lecteur de conversation (c3) ; textes de l'éditeur de persona qui nomment encore « l'agent » pour elle (lot à part).
Découvertes : aucune.
