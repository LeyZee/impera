# 2026-11-02 — calendrier des shifts pour toute l'équipe et la créatrice (ADR 0045, proposée)
Fait : demande de Charles (16h36) d'un planning visible par le manager, le chatteur et la créatrice ; état de l'existant (Équipe › Planning, Mon planning, Membres) vérifié avec le fil Équipe ; lecture fonctionnelle du planning d'Imperium sur son PC (hors dépôt, aucun code repris) ; 11 questions avec recommandations, toutes retenues par Charles à 16h44 avec ses nuances (glisser au doigt, rappels par l'application et pas par Telegram, réglés par chacun). ADR 0045 écrite, index des ADR mis à jour.
Pas fait : aucun code ; le prototype cliquable du calendrier et la fiche du lot, après l'acceptation.
Décisions : le chatteur voit toute l'équipe par une vue étroite (nom dans l'équipe, couleur, créatrice, créneau), jamais `team_members` ; la créatrice voit les shifts de ses comptes dans son Agenda ; un membre n'est jamais effacé.
Découvertes : la politique `member_read` de `shifts` (migration 0021) ne laisse au chatteur que ses propres shifts, alors que l'ADR 0024 lui promettait déjà « celui de l'équipe » ; Imperium ne prévenait pas un chatteur d'un shift déplacé ou retiré.
Candidats à suppression : aucun.
Vérifié : `pnpm check`.
