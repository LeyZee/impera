# 2026-10-30 — Runbook « Session plateforme expirée » aligné sur la session du membre « bot » — done

Fait : `docs/runbooks/session-expired.md` dit de se connecter avec le compte du membre d'équipe « bot » créé dans Reveal, jamais avec la session de Charles ni celle d'un chatteur, comme la fiche `PROPOSED-reveal-connector.md` (décision du 17/10) ; il précise que la capture dans l'extension (bouton Sync) n'est pas encore codée, alors que la route `POST /v1/connector/sessions` existe déjà côté serveur (remarque de Bilan) et que l'étape 5 vise le compte du bot. La fiche note la route réservée `/aide/reveal` de l'aide « Reconnecter Reveal » (DASH-18), écrite avec la capture.
Décisions : pas de page d'aide avant la capture de session, pour ne pas décrire un bouton Sync qui n'existe pas encore (accord du coordinateur).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check` ✓ (docs seules).
