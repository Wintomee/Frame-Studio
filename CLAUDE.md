# Frame Studio: handoff for Claude Code

Read this before changing anything. It captures the goal, the decisions already made with the user, and the
invariants that are easy to break. `README.md` covers deploying and installing.

## Goal and user

- **User:** Tomas, an indie game developer in Prague. He owns a Samsung Frame TV and wanted a personal replacement for
  the iPhone app *Layoutz*, tailored to how he works. He uses it on an iPhone, as an installed PWA hosted on GitHub Pages.
  A PWA was chosen to avoid paying for an Apple developer account.
- **Job to be done:** import a batch of photos, get them grouped automatically into good-looking **3840 × 2160 (16:9, 4K)**
  collages, fine-tune quickly, apply a frame, export to Photos, then upload to the TV via SmartThings.
- **What he cares about:** speed of workflow over options; equal white space everywhere (outer padding = gaps between
  photos); photos not cropped too much, not blurry, not tiny; minimal UI text; vertical screen space is precious.
- **How he gives feedback:** short numbered notes after trying each build on his phone. Expect iterative, opinionated UX
  feedback. Prefer doing what he asks and flagging trade-offs briefly, rather than long explanations.

## Architecture

Everything is one self-contained `index.html` (HTML + CSS + vanilla JS, no build step, no framework), plus `sw.js`
(offline cache), `manifest.webmanifest` and `icons/`. Keep it single-file unless there's a strong reason; it was
iterated that way and the tests read it directly.

Script layout, top to bottom:

1. **Solver** between `/*SOLVER-START*/` and `/*SOLVER-END*/`. Pure functions with no DOM access, unit-tested by
   extracting this block in `tests/solver.test.mjs`. Keep it DOM-free.
2. **State** `S`: pages, active index, padding, background, frame and frame options (`S.fopt`), rules, selected cell, tab.
3. **Frames** (`FRAMES`), drawing (`drawBase`, `drawPhoto`, `drawPreview`), `render()`.
4. **Loading**: `parseExif` (date + GPS), `loadPhoto`, preview generation.
5. **Persistence** (IndexedDB), set operations, import, gestures, filmstrip, tabs, suggestions, crop editor,
   try-another, export, reframe.

### Coordinate system
All geometry is in **export pixels** (`W=3840`, `H=2160`). The preview canvas just scales with `setTransform`.
`S.k` = export pixels per CSS pixel, used to size overlays (handles, badges) consistently.

### Layouts
`DEFS`/`LAYOUTS`: each layout is a set of split-line positions `x[]`, `y[]` (0..1) and `cells` as
`[c0,r0,c1,r1]` line indices. **Rows or columns that should move independently get their own line**, e.g. a 2×2 grid
has `x:[0,.5,.5,1]` so the top and bottom rows split independently. `boundsOf` derives drag limits for a line from the
cells that touch it. Borders between photos are draggable handles (`gutters()`).

`rectsOf(L, pad, ins)`: `ins` is the outer moulding width (wood/metal frames). **Padding is measured inside the
moulding**, so the visible mat around the outside equals the gaps between photos. The user explicitly asked for this.

### Solver and scoring
- `scoreL`: per photo, *keep* = the fraction of the photo still visible after cover-cropping into its cell, *up* = the
  upscale factor (blurriness), *area* = the cell's share of the screen. Rule violations add large penalties.
- `optimizeL`: coordinate descent on split lines to fit cells to the photos' aspect ratios. This is the core trick
  that keeps crops small.
- `bestPage`: tries every layout × every distinct order of aspect classes (`permsOf`, using `akey` = rounded log
  aspect) and optimizes all of them. It used to optimize only the top 6 guesses, which produced 20%-keep disasters.
- `compose(pool, R)`: groups photos into pages with dynamic programming. `solveOrdered` makes contiguous groups in
  time order; `solveUnordered` does a DP over counts of each aspect class. `groupCost` is cached per aspect multiset.
- **Rules** (`S.rules`, presets in `PRESETS`): `minKeep` (crop limit), `maxUp` (no upscaling), `minArea` (smallest
  photo share of the screen, default 8%), `portrait` ("a vertical goes with 1 horizontal or 2+ other verticals"),
  `min`/`max` photos per image, and `dates` (0 none / 1 medium / 2 max: "keep moments together").
  `validPage` is the single definition of "passes the rules".
- **Moments** (`clustersOf`): photos sorted by time; each gap is scored as `log(seconds+60) + log(1+km)` (km from EXIF
  GPS when both photos have it). A gap is a cut if it exceeds the median of the 4 gaps on each side by a margin
  (×5 for medium, ×3 for max). This adapts to any time scale. Small moments then merge into their nearest neighbour.
  Photos mix freely within a moment (medium) or stay time-adjacent (max). Do not reintroduce fixed time thresholds;
  the user rejected that.
- **Try another arrangement** (`buildAlts` / `tryAnother`, the shuffle button): focused on the *current* image. In
  order: (1) same photos, another valid layout or order; (2) one trade with a single nearby image in the same moment:
  swap, move out, take in, or absorb a one-photo image; (3) only if nothing else exists, the same trades across moments.
  Every option must pass `validPage`. Repeated taps cycle through the options and then back to the original.
- **Suggestions row** (Layout tab): best arrangement per layout for the current photos, plus "Split into 2", plus
  "Merge with next/previous". Merge is only offered when one side has a single photo **and** the result is valid. The
  user disliked merges that created invalid layouts. Layout icons that can't hold the photos within the rules are
  shown faded and dashed.

### Frames: important invariant
Frames **never paint inside photo rects**. Photos are drawn after the frame, and decorations live only in the
padding or the outer moulding. This is what makes reframing possible. Current frames: Plain, Gallery mat (bevel
colour), Wood (tone, moulding width, bevel), Metal (finish, width), Floating (shadow depth), Art deco (line colour,
corners). Polaroid was removed at the user's request. Canvas `shadowBlur` is not affected by transforms, so it is
multiplied by `c.getTransform().a` so the preview matches the export.

### Export and reframe
- Export renders the base, then each photo from its **full-resolution file**, decoded one at a time to save memory.
  The output is a JPEG at quality 0.92.
- The layout JSON (photo rects, cells, lines, padding, frame, frame options) is embedded as **XMP (APP1) plus a COM
  segment** (`withMeta`/`readMeta`). "Reopen an export" cuts the photos back out pixel-for-pixel from the stored rects,
  so the frame can be changed later with only the exported JPEG. **Still unverified:** whether iOS Photos and the file
  picker preserve this metadata on a real iPhone. If it gets stripped, the fallback idea is detecting photo edges in
  the image.
- On iOS, export uses the share sheet (`navigator.share({files})`). Because rendering takes longer than the user-gesture
  window, files are rendered first and a "Save N images to Photos" button then shares them all in one tap. The
  `window.claude` downloads branch is left over from the Claude-hosted prototype and is inert here.

### Crop
Per-photo `crop` {x,y,w,h} (0..1 of the original). `ow`/`oh` are the original pixel dimensions; `w`/`h` are the
**effective (cropped)** dimensions used everywhere, including the solver, the upscale check and drawing. After a crop
the page is re-fitted, and if it becomes invalid the cheapest `buildAlts` option is applied automatically.

### Persistence
IndexedDB `frame-studio-v2` with stores `assets` (original file blob plus a ~1000px `prevBlob`, dims, date, GPS) and
`kv` (`state`: pages, crops, rules, style). Restore decodes **only the small previews**. Decoding every full-res photo
on load crashed the iOS web view. A `localStorage` flag (`fs-restoring`) skips restore once if the previous attempt
crashed. Unreferenced assets are purged on save, except while an Undo is pending or an import is running.

### Locking (hidden, candidate for removal)
Pages auto-lock when edited by hand, and recompose skips locked pages. The lock UI is hidden because the user isn't
sure it's needed; the code is kept for now. Decide with him before removing or exposing it.

## UI decisions already made (don't undo without asking)
- **Import always auto-composes**, then opens the Auto-arrange sheet (presets + collapsible fine-tune + try another),
  so rules can be changed straight away. Rules are not a tab.
- Tabs: **Layout** (the only place editing gestures work), **Frame** (preview is view-only, no handles or badges),
  **Export**. The tab bar is compact (icon and label inline, reduced bottom safe area).
- No status/info row: messages are a transient pill at the top, and photo actions (replace, crop, reset zoom, remove)
  float above the tab bar when a photo is selected. Delete image = ✕ on the active thumbnail. Undo is via the toast.
- Shuffle and full screen are small stacked buttons at the end of the filmstrip row.
- **Full screen** rotates the image 90° when the phone is upright (works with rotation lock on); `toExp` maps touches
  for the rotated canvas. It has prev/next buttons, a counter and swipe: a horizontal swipe flips images once the photo
  under the finger can't pan further that way, and that photo's pan is reverted.
- Corner badge on each photo shows **which way it can currently be dragged** (↔, ↕ or both), not the photo's original
  orientation. It turns red with "!" when the photo is upscaled (blurry). No badge = can't move.
- Frame picker is a horizontal scroll row; options for the selected frame appear below it. Background has 5 swatches
  plus a custom colour picker.
- Gestures: drag = pan, pinch = zoom, double-tap = reset (photo or border), hold + drag = swap, or drop on a filmstrip
  thumbnail to move the photo to that image; tap an empty spot to add a photo.
- Minimal text throughout. Remove explanatory copy rather than add it.

## Known issues / open questions
- Verify on a real iPhone: XMP survives Photos; GPS survives the picker (iOS may strip location; time-only fallback
  works); pinch feel; hold delay (380 ms).
- Unordered DP can blow up with many distinct aspect classes; `plan()` falls back to `dates=2` above ~20k states.
- Swap ghost uses the uncropped preview.
- Sending images straight to the TV isn't possible from a browser; SmartThings stays the last step.

## Suggested next steps (agreed direction, not yet built)
1. Warning dots on filmstrip thumbnails (empty spot, blurry photo, rule broken).
2. A **tray** for unused or removed photos, with drag back into any image.
3. Near-duplicate detection on import (perceptual hash); dupes go to the tray.
4. Multiple **sets** (e.g. "Summer trip", "Christmas"), each with its own style and rules; mark exported images and
   re-export only changed ones.
5. Multi-step undo history.

## Working conventions
- After any change: `node tests/solver.test.mjs`, and `python tests/e2e_smoke.py` for UI changes. Look at the
  screenshots in `tests/out/`. Several past bugs were only visible there, e.g. CSS `display` overriding `[hidden]`
  (now fixed globally) and a grid item overflowing the header.
- Bump `VERSION` in `sw.js` on every deploy.
- UI copy uses typographic apostrophes and quotes (’ “ ”). Code uses straight quotes.
- Colours are CSS variables with dark-mode overrides; keep new UI on those tokens.
