# Parcours — photos prises par erreur

À faire une fois, sur le Mac, avec la vraie photothèque. Ce que les tests ne
voient pas : l'écran, et si les photos proposées sont vraiment ratées pour toi.

Mesuré avant ce parcours, sur une copie de la base (2026-10-02) : 9 509 photos
notées, 40 proposées dans la nouvelle rubrique, en plus des floues et presque
noires déjà trouvées.

1. **Lance la nouvelle version** (`npm run dev`, ou la prochaine release).
   Tu dois voir : l'app s'ouvre normalement. Réponds : « ouvre » ou l'erreur.
2. **Ouvre Nettoyage, onglet Suggestions.**
   Tu dois voir, sous « Anciennes captures d'écran », une ligne
   « Photos prises par erreur » avec une quarantaine d'éléments.
   Réponds : le nombre affiché.
3. **Clique dessus et regarde les photos.**
   Tu dois voir surtout du sol, des plafonds, des doigts, des poches, du bougé.
   Réponds : combien te semblent à garder (une estimation suffit).
4. **Regarde les cases.**
   Tu dois voir : aucune photo cochée d'avance dans cette rubrique (les autres
   rubriques restent toutes cochées). Coche ce que tu veux jeter ; une bonne
   photo proposée, coche-la et clique « Ne plus proposer ».
   Réponds : « rien coché » ou ce que tu vois.
5. **Passe en mode nuit** (réglage système).
   Tu dois voir : la rubrique lisible, sans couleur nouvelle.
   Réponds : « ok » ou ce qui cloche.

Si plus d'une photo sur cinq est à garder, le seuil `MISHAP_MIN`
(`src/core/ml/mishaps.ts`) monte ; s'il en manque beaucoup, il descend.
