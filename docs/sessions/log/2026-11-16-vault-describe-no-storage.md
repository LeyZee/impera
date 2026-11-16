# 2026-11-16 — vault-describe-no-storage (description du coffre sans stockage de fichiers) — done
Fait : `media.describe_vault` fait la miniature avant l'appel de vision, pour qu'un stockage en panne ne coûte plus une description payée puis perdue ; sans stockage configuré (`S3_*` absent), `pictureOf` ne fait aucune miniature et le média est gardé décrit, sans miniature. Constaté au premier test du coffre sur le poste local (aucun stockage) : chaque lot échouait après la vision.
Pas fait : rien.
Décisions : une miniature faite avant un refus de budget ou de modèles reste stockée sous l'empreinte du fichier ; la reprise l'écrit à nouveau sous la même clé, sans doublon.
Découvertes : les médias du coffre gardés sans miniature n'en auront pas plus tard (rien ne la refait sans l'original) ; à prévoir si un stockage arrive.
Candidats à suppression : aucun.
Vérifié : tests vault-describe et content-drops ✓ ; aucune description lancée.
