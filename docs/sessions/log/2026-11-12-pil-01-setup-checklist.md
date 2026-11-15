# 2026-11-12 — PIL-01 « Mise en route » cochée par le serveur — done
Fait : contrats `setup.ts`, domaine pur et lecture admin dans `supervision`, routes `GET /v1/dashboard/setup/creators` (propriétaire seul) et `/members` (propriétaire, et manager actif pour les chatteurs sans facturation), carte de la liste des Créatrices (remplace « À configurer »), bloc sur la fiche d'une créatrice et sur celle d'un membre ; glossaire « Mise en route ». Relecture design corrigée ; relecture Équipe corrigée : « Facturation prête » d'un membre payé (raison de `invoiceReadiness`, port branché au composition root), invitation expirée à refaire, créatrices archivées hors compte.
Pas fait : « Ma mise en route » du chatteur (découverte) ; relire réglages et régimes une fois pour toute l’équipe (optionnel, relecture Équipe).
Décisions : aucune ADR (plan de pilotage, W1 « sans ADR ») ; heures par défaut = faites et dites ; vérification de fiabilité lue par plateforme, sur des jours où son compte existait ; « ok manager mise en route » (Charles, 12/11).
Découvertes : « Ma mise en route » vue par le chatteur lui-même (Moi) ; à proposer à Charles.
Candidats à suppression : aucun (`creators/setup.ts` et son test, remplacés, sont retirés dans cette PR).
Vérifié : voir la PR.
