# 2026-11-21 — INS-05 lot a (« À décider », les cartes de décision de la créatrice) — in progress

Fait : ADR 0164 ; contrat `creator-decisions` ; table `creator_decisions` (migration 0250, FORCE RLS, une fois par sujet, colonnes d'une réponse seules écrites) ; module `creator-decisions` (porte du code qui demande sous `withTenantJob`, routes de la créatrice et du propriétaire, ligne d'audit quand il répond à sa place) ; carte « À décider » en haut d'« Aujourd'hui » selon les captures validées. Avec le même lot : « Relier ce lien » n'écrit que si le lien a encore l'adresse lue auprès du service (remarque de Sécurité sur INS-02 lot e2b).
Reste : lot b (notification, légendes proposées, « D'autres idées », écran du propriétaire), lot c (publication, après le branchement Meta) ; INS-02 lot e3 (heures dans Trafic).
Découvertes : `drizzle-kit generate` nomme la migration par son rang dans le journal (0188) et écrase l'instantané du même numéro : le restaurer avant de renommer.
