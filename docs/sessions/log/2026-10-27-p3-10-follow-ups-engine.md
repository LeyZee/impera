# 2026-10-27 — P3-10 Relances, part moteur — done

Fait : `followUpDecision` décide en code si une relance part (jamais à un fan à ne plus contacter ni en détresse, jamais au-delà des délais de la persona, de 23 h à 9 h chez elle reportée à 9 h par `retryAt`). Le composeur de l'agent lit `ComposeInput.followUp` : limites du fan lues d'abord (inconnues → rien), pas d'appel au cerveau, brief fixé par le code (rien de payant, aucune allusion sexuelle), toutes les gardes dont `explicit_before_age`. `startFollowUpPlan` exporte les délais de la persona ; la composition root branche `followUps` à côté du composer de l'agent seulement (ligne en ajout, accord de Bilan). Playground : `/relance` après `/avance`.

Pas fait : relances de vente après un refus (au plus deux, `post_offer.delay_days`) : elles attendent l'historique des scripts Reveal (P6-01) ; d'ici là une relance ne vend jamais.

Décisions : un fan silencieux n'est pas une urgence, donc ni limites illisibles, ni modèle absent n'alertent ; seule une garde bloquante passe la main. Les heures calmes de la relance (23 h à 9 h chez elle) sont distinctes de celles des notifications d'un membre.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration sur Postgres 16 local.
