# 2026-11-05 · PRO-04 et reco 22 : date de naissance de la créatrice

- Fiche : recette du 05/11, PRO-04 et reco 22 (Charles, « go recos » et « attaque tous les constats »).
- Fait : l'écran Persona vérifie l'âge à la date du jour, celle que l'enregistrement écrit, et non à la date de la dernière version. Une créatrice devenue majeure depuis n'est plus refusée à l'écran alors que le serveur l'acceptait. Le contrat refuse en plus une date de naissance de 100 ans ou plus avant la version (`MAX_CREATOR_AGE`) : « Plus de 100 ans : vérifie l'année de naissance ». La règle est la même à l'écran, à l'import d'un fichier et côté serveur.
- Tests : `persona.test.ts` (borne haute : 1890 et 100 ans pile refusés, 99 ans acceptés) ; `PersonaSection.test.tsx` (18 ans le jour même accepté sous une version plus ancienne, échoue sans le correctif ; 1890 signalé).
- Découvertes : aucune.
