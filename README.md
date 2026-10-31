# Zúzó (PWA)

1. Töltsd le a Matter.js-t ebbe a mappába `matter.min.js` néven:
   https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js
   (Ha nincs meg, a játék az első online indításkor magától letölti és cache-eli.)
2. Szolgáld ki HTTPS-en vagy localhoston (PWA-hoz kell), pl.: `python3 -m http.server 8080`
3. Böngészőben: Telepítés / Kezdőképernyőhöz adás.

- Három gép-kártya (Prés, Daráló, Olvasztó), mindegyik külön fizikai világ és külön fejleszthető.
- Új tárgy: `items.js` (kategóriánként egy sor). Filmes hősök: „Filmes hősök (utánzat)” kategória – paródia-nevek.
- Gépek rajza: `paintPress/paintGrind/paintMelt` (háttér) és `DRAW` (mozgó alkatrészek) a game.js-ben.
