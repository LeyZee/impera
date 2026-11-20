# 2026-11-20 — Demande sur mesure : la commande enregistrée (ADR 0159 § A) — done
Fait : table `custom_orders` (migration 0239, RLS forcée, politique par créatrice, fermée à son compte, lecture seule pour le rôle de service), une commande ouverte par fan au plus, fan lié à la créatrice de la commande (clé composée sur la nouvelle `fans_id_creator_unique`) ; port `orders.openFor` / `orders.record` du module `custom-orders`, appelé par le tour de l'agent dans sa transaction `withTenant`, idempotent sur l'id plateforme du message du fan ; id `CustomOrderId` au contrat ; tests d'intégration (ouverture, même message une fois, fiche gardée, refus qui ferme, tour sans commande, autre créatrice) ; ADR 0159, glossaire, README.
Pas fait : le branchement dans le tour (fil Agent, même train), la fiche détaillée et le oui ou non de la créatrice dans « À traiter » (lot 1 de l'ADR 0159). D'ici là, la ligne « Demande sur mesure » d'« À traiter » reste celle de l'ADR 0090.
Décisions : signature du port fixée avec le fil Agent (20/11 23 h 07) ; aucun accès par le rôle de service.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : intégration `custom-orders`, `creator-account-rls`, `rls-policies`, `rls`, `service-role` ; dérive du schéma alignée ; typecheck.
