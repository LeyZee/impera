# 2026-11-16 — vault-describe-no-storage (description du coffre sans stockage de fichiers) — done
Fait : `media.describe_vault` fait la miniature avant l'appel de vision, pour qu'un stockage en panne ne coûte plus une description payée puis perdue ; sans stockage configuré (`S3_*` absent), `pictureOf` ne fait aucune miniature et le média est gardé décrit, sans miniature. Constaté au premier test du coffre sur le poste local (aucun stockage) : chaque lot échouait après la vision.
Pas fait : rien.
Décisions : une miniature qu'aucune ligne média ne porte (budget, modèles, « à décrire par l'agence », erreur après elle) est retirée du stockage, sinon aucun effacement ne la retrouverait (ADR 0113 § 1, demande Sécurité) ; la reprise la refait pour le prix d'un ffmpeg. Si le retrait échoue, le job échoue sans nommer la clé et sera rejoué. Exception : quand un média gardé (dépôt, média de fan) a les mêmes octets, la clé est la sienne et la miniature reste ; l'empreinte est relue juste avant le retrait (remarque Médias et Sécurité).
Découvertes : les médias du coffre gardés sans miniature n'en auront pas plus tard (rien ne la refait sans l'original) ; à prévoir si un stockage arrive.
Candidats à suppression : aucun.
Vérifié : tests vault-describe (une sortie par test) et content-drops ✓ ; aucune description lancée.
