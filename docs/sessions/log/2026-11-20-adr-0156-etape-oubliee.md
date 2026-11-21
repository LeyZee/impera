# 2026-11-20 — ADR 0156, lot 2 : une étape oubliée n'est pas un refus — done
Fait : quand il revient alors que la session chaude est retombée (désir sous le seuil de la créatrice) et qu'une étape payante attend, le déroulé passe en pause (`session_cooled`, statut `stalled`) au lieu de compter son « salut » comme un refus ; un « non » clair reste un refus. À ce message, si l'étape n'a jamais été ouverte, la décision `end` porte l'étape (`unopened`) et la voix reçoit une consigne du code : une taquinerie légère, une seule fois, sans prix ni nouvelle proposition. Éval `script-unopened-next-day`, terme « Étape oubliée » au glossaire.
Pas fait : relancer plus tard une étape ouverte mais pas achetée (lot des relances de vente).
Découvertes : aucune.
