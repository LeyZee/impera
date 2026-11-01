# 2026-10-28 — Session Reveal : la date ne bouge que pour une nouvelle session — done
Fait : `POST /v1/connector/sessions` déplaçait `session_updated_at` à chaque envoi, même pour la session déjà enregistrée. Depuis #287, le Dashboard compte le retard de lecture depuis la plus récente de `last_poll_at` et `session_updated_at` : une extension qui renvoie la même session aurait masqué un worker arrêté. La date ne bouge plus que si la session change (comparée en clair, car GCM chiffre différemment à chaque fois ; une session qui ne s'ouvre plus compte comme changée) ou si elle est enregistrée sur un compte sans session ou expiré. La comparaison se fait sous le verrou de la ligne du compte (`isSame` appelé dans la transaction de `storeSession`), donc deux envois simultanés ne datent la session qu'une fois (remarque d'Agent sur #289). Le reste est inchangé : session rechiffrée, état `valid`, disjoncteur fermé, ligne d'audit.
Pas fait : rien.
Décisions : `warning` → `valid` avec la même session ne compte pas comme une nouvelle session.
Découvertes : aucune (relevé par le fil Recette).
Candidats à suppression : aucun.
Vérifié : `connectors.integration.test.ts` ✓ (8), le nouveau test échoue sans le correctif ; `pnpm check` avant le push.
