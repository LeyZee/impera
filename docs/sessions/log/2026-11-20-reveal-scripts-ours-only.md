# 2026-11-20 — SCB-04 « Ses scripts dans Reveal » : seulement nos copies — done
Fait : la carte « Ses scripts dans Reveal » (onglet Scripts d'une créatrice) ne liste plus que les scripts natifs qu'un import a reconnus comme la copie d'un script préparé dans Impera ; ses autres scripts Reveal (ceux d'un ancien outil compris) n'y sont ni listés, ni proposés, ni validés. Sans copie reconnue, la carte le dit en une ligne. Aucune donnée supprimée.
Pas fait : rien côté serveur.
Décisions : règle de Charles du 20/11 : l'écran ne montre que les scripts créés dans Impera ; ceux de Reveal servent seulement à reconnaître une copie.
Découvertes : le câblage de l'agent propose encore tout script natif proposable dont l'identité est validée, reconnu ou non ; le verrou côté serveur est confié au fil Agent.
Candidats à suppression : aucun.
Vérifié : tests web de l'onglet Scripts (49), lint et typecheck du dossier.
