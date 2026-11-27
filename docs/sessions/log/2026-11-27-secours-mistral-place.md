# 2026-11-27 — Le secours Mistral a la place de réfléchir et de répondre — done
Fait : le secours d'un rôle peut porter sa propre place de sortie et son propre délai (`fallback.maxOutputTokens`, `fallback.timeoutMs`) ; celui de la voix et du cerveau (Mistral Large 4) reçoit 8 000 jetons et 120 s. Sans ça, Mistral, qui raisonne avant de répondre et compte ce raisonnement dans sa sortie, ne tenait pas dans les 800 jetons du cerveau ni les 400 de la voix : le 27/11, quota xAI épuisé, 10 réponses du cerveau sur 11 sont revenues invalides et 1 hors délai (PC, fiche de démo).
Pas fait : la mesure sur le vrai chemin (évals complètes sur Mistral, choisie par Charles pour le 28/11) confirmera.
Décisions : aucune nouvelle ; défaut du secours seulement, le modèle principal ne change pas.
Découvertes : rien.
Candidats à suppression : rien.
Vérifié : tests de `packages/llm` (dont un nouveau : le secours reçoit 8 000 jetons quand xAI refuse pour quota), typecheck de `packages/llm` et de l'API.
