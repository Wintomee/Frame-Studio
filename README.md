# Frame Studio

A personal web app for composing 3840 × 2160 photo collages for a Samsung Frame TV.
It runs entirely on the phone: photos are never uploaded anywhere. GitHub Pages only hosts the app files.

## Deploy (with Claude Code)

Open this folder in Claude Code and ask:

> Create a public GitHub repo called `frame-studio` from this folder, push it, and enable GitHub Pages from the `main` branch root. Give me the URL.

Or by hand with the GitHub CLI:

```bash
git init && git add . && git commit -m "Frame Studio"
gh repo create frame-studio --public --source=. --push
gh api -X POST repos/{owner}/frame-studio/pages -f "source[branch]=main" -f "source[path]=/"
```

The app appears at `https://<username>.github.io/frame-studio/` after a minute or two.
(Free GitHub Pages needs a public repo. The code becomes public; your photos do not.)

## Install on the iPhone

1. Open the URL in **Safari**.
2. Share → **Add to Home Screen**.
3. Launch it from the home-screen icon. It runs full screen and works offline after the first load.

## Updating

After changing `index.html`, bump `VERSION` in `sw.js` (e.g. `fs-v1` → `fs-v2`) and push.
Phones pick up the new version the next time the app is opened with a connection.

## Tests

```bash
node tests/solver.test.mjs        # layout solver, no dependencies
python tests/e2e_smoke.py         # headless iPhone-size smoke test (needs playwright + pillow)
```

## Getting images onto the TV

Export → images go to the share sheet → **Save Images** to Photos → SmartThings app → Art Mode → upload.
In Art Mode set the matte to **None**, otherwise the TV adds its own border on top of the app's frame.
