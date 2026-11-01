# 2026-10-22 · CI : les paquets de ffmpeg en cache, installés sans réseau

Fait : le job Tests garde dans le cache d'Actions les `.deb` que apt télécharge pour ffmpeg, par image du runner (`ImageOS` et `ImageVersion`). Quand le cache existe, `dpkg -i` les installe sans toucher au miroir. Sinon, apt (trois essais bornés, 90 s pour `update`, 180 s pour `install`) les télécharge dans ce dossier, et le cache est enregistré aussitôt après l'installation, même si un test échoue ensuite. Le délai du job passe de 20 à 30 min, celui de l'étape de 10 à 15 min.

Pas fait : rien.

Décisions : pas d'action tierce ni de binaire statique téléchargé hors de GitHub. On reste sur les paquets d'Ubuntu, dont seule la source change (le cache plutôt que le miroir).

Découvertes : le 22/10 à 22h15, sur #123, les trois essais ont chacun dépassé les 120 s d'`apt-get install` (miroir lent), après deux gels complets les jours précédents.

Candidats à suppression : aucun.

Vérifié : YAML et script analysés en local (`yaml.safe_load`, `bash -n`), `pnpm check` ; le premier passage de la CI remplit le cache, et le suivant doit l'installer par `dpkg` seul.
