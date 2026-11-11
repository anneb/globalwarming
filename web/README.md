# Koolstofblok — prototype

Interactieve 3D-doorsnede (30 × 16 km, 10 km diep) die laat zien hoe koolstof
uit gesteente in de atmosfeer komt: langzaam van nature (vulkaan, oxidatie van
opgetilde lagen) en snel door de mens (mijn, bron, centrale). Dezelfde scène
levert ook de video.

Achtergrond en getallen: [`../docs/wetenschap-koolstofkringloop.md`](../docs/wetenschap-koolstofkringloop.md).

## Draaien

```bash
npm install
npm run dev          # open de getoonde URL in de browser
```

Bediening: slepen = draaien, scrollen = zoomen, rechtsklik-slepen = schuiven.
Knoppen: natuurlijke kringloop / mens grijpt in, snelheid, labels, fossiele
koolstof markeren, ▶ film (camera volgt vast pad).

## Video renderen

```bash
npm run record -- --seconds 80 --w 1920 --h 1080 --out ../video/blok.mp4
npm run record -- --seconds 5 --from 40          # kort stukje vanaf t=40 s
node scripts/snap.mjs /tmp/stills 0 11 22 60     # losse PNG-stills op tijdstippen
```

Rendert frame voor frame (deterministisch, vaste seed) in headless Chromium en
encodeert met ffmpeg (`ffmpeg-static`). Elk frame is exact gelijk, ongeacht hoe
snel de computer is.

## Opbouw

| Bestand | Inhoud |
|---|---|
| `src/geology.js` | Terrein, lagenmodel (opheffing, plooiing), vulkaan, magmakamer, ontsluitingen |
| `src/strataShader.js` | GLSL: kleurt elk punt van het blok op basis van wereldpositie → consistente 3D-lagen op elk snijvlak. Moet `geology.js` spiegelen. |
| `src/terrain.js` | Blokgeometrie (bovenkant + 4 wanden + bodem), oceaan, atmosfeerkader |
| `src/particles.js` | Koolstofdeeltjes: 1 stip ≈ 0,05 GtC. Paden door leidingen, opstijgen, drijven, opname door land/oceaan |
| `src/sim.js` | Uitstoot per jaar (fossiel + ontbossing), ppm-berekening, natuurlijke fluxen |
| `src/infrastructure.js` | Oliebron, kolenmijn, centrale, transportleidingen + deeltjespaden |
| `src/cameraPath.js` | Camerapad van de film |
| `src/main.js` | Scène, licht, labels, HUD, ondertitels, film- en opnamemodus (`?record=1`) |
| `scripts/record.mjs` | Video-opname |
