# apps/web/scripts/

Developer scripts, run by hand. Not part of the build.

- `make-enclosure-fixture.mjs` — writes `public/enclosure/fixture.glb`, the enclosure viewer's mock model: a 90 × 60 × 35 mm rounded enclosure with 1.6 mm walls, a floor cable hole, a vented lid, and ghost parts. Deterministic; `src/components/enclosure/fixture.test.ts` checks that it reproduces the checked-in file byte for byte.

  ```sh
  cd apps/web
  node scripts/make-enclosure-fixture.mjs          # or --out <file>
  ```

  After changing the model, refresh the static fallback `public/enclosure/fixture.png`: a screenshot of the viewer's stage in the Exploded view with parts shown (mock mode, 1200 × 900).
