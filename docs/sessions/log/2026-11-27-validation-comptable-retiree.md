# 2026-11-27 — Paie : la validation du comptable retirée de l'écran — done
Fait : Réglages › Facturation ne montre plus la pastille « Validé », la ligne « Validation » ni le bouton « Noter la validation » (dialogue retiré) ; l'ordre des régimes ne dépend plus d'elle ; le dossier du membre ne parle plus du comptable. ADR 0023 amendée, tests d'écran ajustés.
Pas fait : rien.
Décisions : Charles, 27/11/2026 : « je préfère la retirer vu que mon agent IA va me servir de comptable désormais ».
Découvertes : la colonne `validated_on` et la route `POST /v1/payroll/billing-regimes/:id/validation` restent, sans écran ; les retirer serait une migration destructive, à décider plus tard.
Candidats à suppression : la route de validation côté serveur.
Vérifié : tests web des écrans touchés ✓ ; pnpm check et pnpm test au pre-push.
