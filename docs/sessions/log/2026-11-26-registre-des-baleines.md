# 2026-11-26 — Baleines : le registre suit le palier (ADR 0132 § 7) — done
Fait : `spenderRegisterOf` (agent/domain) choisit le registre depuis le palier du fan (`FanTier`) : baleine `girlfriend`, très bon payeur `close`, en dessous `warm` (choix de Charles du 26/11) ; borné à `close` si fragile ou ventes gelées pour argent, `warm` en soin ou palier inconnu. La voix reçoit une consigne de conduite (`SPENDER_REGISTER_HINTS`), jamais le palier. Le palier et le dernier achat viennent du registre des ventes (`fanStats` lit `fanStanding`) ; la pause après achat prend le plus récent des deux dates connues (registre, Reveal).
Pas fait : réglage du registre par créatrice et par palier (écran, lot Design de l'ADR 0132), priorité de file (§ 10), cases de fiche en plus dès `close` (§ 8), consigne libre par palier (§ 11), style de base de l'agence en base.
Décisions : le texte du registre est une consigne de ton dans le code, comme les autres consignes de la voix, plutôt qu'un fichier `voice/register-*.md` (le prompt de la voix est en cours de modification dans #1043).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires (`spenderRegisterOf`, consignes vues par la voix selon le palier) ; `pnpm check`. Intégration non lancée ici (pas de Docker), la CI la lance.
