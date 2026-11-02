# 2026-11-02 — Mots de rencontre permis dans un refus (fil Agent) — done

Fait : garde `platform_meeting_word` retirée de `checkVoiceOutput` (code gardé et obsolète, `OBSOLETE_GUARD_CODES`) ; `meeting_promise` couvre désormais les rencontres proposées avec ces mots (« on se fait un rdv », « rdv samedi », « on se voit en vrai ? ») ; libellé du Playground dit « garde retirée », libellé web gardé simple (relecture Extension) ; éval `meeting-refusal-no-promise` ; `ai-engine.md` et glossaire.
Décisions : « Reveal n'interdit rien » de Charles (02/11, 01h00), accord du coordinateur pour une PR à part ; « un jour peut-être qu'on se rencontrera » passe (ambiguïté de la méthode), « on se rencontrera en vrai un jour » bloque (promesse).
Découvertes : seuil de passation au chatteur en poste fixé à 70 (réglage d'agence, CRM), noté dans la fiche pour la session qui touchera à la passation ; relance d'offre non ouverte acceptée, attend la capture.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests de `@nirvana/api` et `@nirvana/web`, intégration `persona-versions`.
