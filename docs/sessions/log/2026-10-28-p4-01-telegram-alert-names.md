# 2026-10-28 — P4-01 Telegram : l'avis nomme l'alerte — done
Fait :
- L'avis d'une alerte porte son nom, comme Suivi › Historique des alertes (#251). Pour une alerte personnalisée, le nom va en titre et dans la phrase « Le message du fan correspond à l’alerte « … » », y compris pour une remise de cause `custom_alert` (son `trigger` est maintenant lu). Les alertes du système prennent `SYSTEM_ALERT_LABELS`.
- Les noms viennent d'`alerts.store.names`, lus une fois par créatrice et par scan. Le composition root les branche (accord de Bilan) et crée `alerts` avant Telegram. Si un nom est illisible, la phrase générique reste et l'avis part quand même.
- Tests : domaine (titres, phrases, repli sans nom), lecture du `trigger` d'une remise (un `trigger` illisible ne bloque pas la remise), intégration (« Appel vidéo · Autre »).
- Docs : ADR 0020 § 3, README du module, fiche P4-01.
Pas fait : rien.
Décisions : le mot déclaré n'est toujours pas lu ; seul le nom écrit par l'agence part.
Découvertes : aucune.
Candidats à suppression : aucun.
