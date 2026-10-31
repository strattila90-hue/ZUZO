# Zúzó (PWA)

1. Töltsd le a Matter.js-t ebbe a mappába `matter.min.js` néven:
   https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js
   (Ha nincs meg, a játék első online indításkor magától letölti és cache-eli.)
2. Szolgáld ki HTTPS-en vagy localhoston (PWA-hoz kell), pl.: `python3 -m http.server 8080`
3. Böngészőben: Telepítés / Kezdőképernyőhöz adás.

Új tárgy: `CATS` a game.js elején. Új zóna: `build()`, `stepTools()`, `hurt()`.
