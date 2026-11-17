# 2026-11-16 : ADR 0121, « Mes liens » et pilotage du trafic ; connecteur de liens, lot a

- **Fiche** : ADR 0121 (fil Instagram), fiche INS-03 créée en `todo` ; INS-02 lot a.
- **Fait** : ADR 0121, acceptée par Charles le 16/11 à 2 h 30 (« ok 0121 »), § 7 à 2 h 32 (« ok régularité ») : écran « Mes liens » de la créatrice, un lien de suivi par emplacement, paliers de trafic réglés dans le CRM, écran « Trafic » de l'agence, récap du jour, régularité. Glossaire : trois termes. INS-02 lot a : contrats Zod du connecteur de liens, port et règles de domaine, `FakeLinkStats`.
- **Tests** : unitaires sur les contrats, le domaine et le faux. Aucune migration, aucune route.
- **Reste** : INS-02 (adaptateur réel, table des relevés, job), INS-03 (table `redirect_links`, routes, écrans, captures), puis les lots suivants de l'ADR 0121.
- **Découvertes** : aucune.
