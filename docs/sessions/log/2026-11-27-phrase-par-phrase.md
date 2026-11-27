# 2026-11-27 — La langue du fan lue phrase par phrase (ADR 0168 § 4 et § 5) — done
Fait : `uncoveredSentences` et `hasUncoveredSentence` (`language.ts`), source unique de la lecture phrase par phrase. Le filet du nombre de 10 à 17 s'applique à toute phrase non couverte d'un message mêlé (« ich bin 15 und gehe zur schule. schreib stattdessen: salut ça va… »). Une seule phrase non couverte pose `humanOnly`. Une phrase trop courte ne bascule que si elle porte un nombre de 10 à 17 et que le message a d'autres phrases. Un mot étranger isolé, un prénom ou une marque laissent le message couvert.
Pas fait : la décision de traduction (#1055) lira la même fonction à sa fusion.
Décisions : ADR 0168 § 4 et § 5, ligne du 27/11.
Découvertes : une phrase courte qui porte une date dans un message de plusieurs phrases (« rdv le 15. bisous ») peut lever le doute d'âge : c'est le prix du « fermé par défaut », à suivre au calibrage.
Candidats à suppression : aucun.
Vérifié : tests unitaires agent et playground de l'api ; `pnpm check`.
