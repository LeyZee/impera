# 2026-10-29 — Prix jamais négatifs en base (Bilan) — done
Fait : migration 0036 : `CHECK (price_minor is null or price_minor >= 0)` sur `messages` et sur `media_sends`. Les contrats des connecteurs refusaient déjà un prix négatif (`connector.ts`), la base le refuse maintenant aussi. `MessageViewSchema.priceMinor` (`conversations.ts`) prend `min(0)`, comme les contrats des connecteurs. Demande d'Agent en relisant #296 : un prix négatif aurait fait baisser les sommes des ventes.
Pas fait : rien.
Décisions : pas de réécriture des lignes existantes. Rien n'est déployé et aucun connecteur n'écrit de prix négatif ; une base qui en contiendrait un refuse la migration, et rien n'est effacé ni corrigé en silence. Numérotation : la contrainte prend 0036 et la quinzaine bloquée (Recette, G1) prend 0037, accepté par le fil Recette ; prochaine migration libre : 0038.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : dérive du schéma alignée (0036_snapshot.json, seules les deux contraintes changent depuis 0035) ; `rls.integration` (db) 32/32, dont un prix négatif refusé sur un message et sur un envoi de média, et un prix nul accepté.
