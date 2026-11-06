# 2026-11-07 — Recette AGT-05 v3 : la panne IA compte comme une urgence — done
Fait : une panne IA (« IA indisponible ») est une urgence à l'écran, quel que soit le ton envoyé par la route. Sa ligne, toujours une seule pour tous les fans, passe en rouge et se range juste après les fans graves, avant ce qu'une personne peut faire ; le plafond IA et la persona inactive restent en ambre, après. Sur le Dashboard, l'en-tête la compte (« dont une urgente ») et dit « Aucun modèle IA n'a répondu : N fans attendent un chatteur. » au lieu de « Rien d'urgent ». Le rond et le titre de l'en-tête passent en rouge dès qu'il y a une urgence, et « depuis N min » est rouge sur une ligne rouge. « Aujourd'hui » compte une panne comme une seule urgence.
Pas fait : rien.
Décisions : choix de Charles « urgent panne » (06/11) ; la couleur se décide à l'écran (`toneOf` dans `agent/queue.ts`), la route garde son ton.
Découvertes : le décompte des lignes graves par créatrice (`grave`, route `/v1/dashboard/todos`, DASH-03) ne compte pas la panne.
Candidats à suppression : aucun.
Vérifié : tests web de la file, du Dashboard et de Suivi, tsc et eslint, captures v4 Nuit et Jour, ordinateur et téléphone.
