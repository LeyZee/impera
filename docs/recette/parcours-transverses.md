# Parcours transverses

Les workflows qui traversent plusieurs zones. Le lot de la première étape les joue ; les autres relisent. Chaque parcours se fait d'un bout à l'autre sur une seule pile, avec plusieurs navigateurs connectés en même temps (un par rôle).

| # | Parcours | Étapes | Lots |
|---|---|---|---|
| T1 | **Une créatrice arrive à l'agence** | le propriétaire importe « Lina Test » depuis Réglages › Ventes (FakeReveal CRM) ou la crée à la main → règle son pourcentage (40 %), ses heures, sa persona, l'active → l'invite → elle installe l'appli, se connecte, voit son Aujourd'hui, son Agenda, ses Ventes vides, sa persona sans l'IA | Bilan → Équipe → Agent → Extension |
| T2 | **Un chatteur arrive et fait son premier shift** | ajout dans Équipe › Membres → invitation → second facteur → dossier → shift posé → Aujourd'hui pendant le shift → Suivi borné → rapport de fin de shift → validation automatique ou bloquée → quinzaine → relevé → facture | Équipe → Bilan → Agent → Extension |
| T3 | **Une vente Reveal de bout en bout** | une vente du fan « fan_alpha » arrive par FakeReveal CRM (webhook signé) → registre → Dashboard « ventes lues chez Reveal » → Telegram Ventes (aperçu) → attribution au chatteur en poste ou à l'agent (membre « bot ») → rapport de shift comparé → paie (compte déclaré, puis détecté en simulation) → gains de la créatrice | Bilan → Équipe → Agent |
| T4 | **Un remboursement tardif** | remboursement d'une vente d'une quinzaine close → ligne négative dans la quinzaine ouverte → relevé → facture | Bilan → Équipe |
| T5 | **Un fan écrit, l'agent répond** (mode simulé) | message entrant FakeConnector → brouillon → Suivi (propriétaire, puis chatteur en shift) → approuvé → envoi idempotent → fiche du fan mise à jour → alerte si risque | Bilan → Agent → Extension |
| T6 | **Passage à l'humain pour vendre** | désir haut → passation au chatteur en poste → il vend → vente attribuée | Agent → Équipe (bloqué : EQ-08, capture) |
| T7 | **Un script, de la demande à Reveal** | structure → demande au bon moment → la créatrice tourne carton par carton → dépôt → l'agence range, exporte le ZIP → « Copié dans Reveal ? » → (plus tard : descriptions, textes, téléversement) | Médias → Extension |
| T8 | **Une idée de la veille jusqu'au tournage** | idée déposée par l'extension (page locale) → Créatrices › Idées → validée → agenda de la créatrice avec fiche de tournage → dépôt | Extension → Médias |
| T9 | **Un membre part** | départ en milieu de quinzaine → accès coupé → shifts à venir libérés → relevé final → solde abandonné si baisse → facture | Équipe → Bilan |
| T10 | **Panne et reprise** | clé Reveal refusée (401) → « à reconnecter » → Telegram → nouvelle clé → `back` → rattrapage des ventes sans doublon ; pareil pour une clé d'IA | Bilan → Agent |
| T11 | **Arrêt d'urgence** | Arrêt global depuis le Dashboard pendant que des brouillons attendent et qu'un envoi part → rien ne sort → reprise → aucun fan oublié | Agent → Bilan |
| T12 | **Sauvegarde et restauration** | sauvegarde → base détruite (pile jetable) → restauration → tout le jeu de recette identique, sessions à refaire | Bilan |
