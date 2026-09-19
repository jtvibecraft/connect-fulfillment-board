# Connect Fulfillment — Public Remaining Board

Static bundle of the Remaining-first fulfillment board. No Node server required.

## What’s included

| File | Role |
|------|------|
| `index.html` / `app.js` / `styles.css` / `priority-pins.js` | UI (same Remaining UX, P1 pins, unsent NFT Qty hero) |
| `config.js` | `mode: 'static'` — absolute Workers URLs + relative JSON |
| `snapshot.json` | Bundled snapshot |
| `exceptions.json` | Bundled exceptions queue |
| `l2e-units.json` | Real L2E unit-counts (unsent NFT Qty); also `unit-counts.json` fallback |

Live APIs (CORS `Access-Control-Allow-Origin: *`):

- `https://promotions-api.asabadoelement.workers.dev/scoreboard/promotions`
- `https://promotions-api.asabadoelement.workers.dev/scoreboard/zero-transactions`

## Deploy (Cloudflare Pages)

1. Drag the entire `public-board/` folder into **Cloudflare Pages → Create project → Direct Upload**, **or**
2. From a git repo: set **Build output directory** to `fulfillment/public-board` (or copy this folder to your Pages root). No build command needed.
3. Open the Pages URL — board loads over HTTPS; live APIs are called from the browser.

Refresh JSON snapshots periodically by re-copying from `/workspace/fulfillment/`:

```bash
cp ../snapshot.json ../exceptions.json .
cp ../raw/l2e/unit-counts.json ./l2e-units.json
cp ../raw/l2e/unit-counts.json ./unit-counts.json
```

## Local smoke test (static)

```bash
cd /workspace/fulfillment/public-board
python3 -m http.server 8080
# open http://127.0.0.1:8080/
```

## Local ops board (Node, :8787)

The editable ops board remains at `/workspace/fulfillment/dashboard/` with `config.js` `mode: 'local'` and `node server.js` on port **8787**. Same `app.js` dual-mode logic.

## Notes

- Do not invent unit counts — refresh from real `raw/l2e/unit-counts.json`.
- If live Workers fail, Remaining still renders from bundled `exceptions.json` / `snapshot.json`; L2E hero needs `l2e-units.json`.
- Opening `index.html` via `file://` will fail fetches; always serve over HTTP(S).
