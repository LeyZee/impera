# 2026-11-16 — Connecteur Reveal : messages supprimés et remise sur un média payant — review

Fiche : aucune (second correctif demandé par la coordination après la mise à jour du PC). Branche : `task/reveal-wire-messages`.
Fait : `wire.ts` accepte `deletedAt` sur un message et `discountedPrice` / `discountDurationMinutes` sur le `bundle` d'un média payant, relevés le 16/11 en lecture seule (formes seulement) ; un message supprimé n'est jamais lu (`fetchMessages` le saute) ; FakeReveal sait supprimer un message (`message_deleted`) et poser une remise sur un bundle ; test contre FakeReveal.
Pas fait : un relevé qui isole une conversation illisible au lieu de tout faire échouer, et une tolérance aux clés nouvelles sans danger : PR suivante, demandée par la coordination.
Décisions : un message supprimé sur Reveal n'entre pas chez nous (choix par défaut annoncé à Charles le 16/11) ; la remise est lue, jamais appliquée (« bloquer et alerter » est codé par Médias).
Découvertes : une seule conversation illisible fait échouer tout le relevé et ouvre le coupe-circuit.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests unitaires ; intégration en CI.
