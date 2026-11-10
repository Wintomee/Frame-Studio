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

### Hero photo and bigger photos
- **Hero** (star in the photo action bar, `ph.hero`, saved per photo): `scoreL` adds a cost so a vertical hero takes
  the full inner height and a horizontal one most of the width, plus a penalty if another photo is bigger. `akey` adds
  100 for heroes so permutations and caches treat them as their own class. Tapping the star runs `heroPlan`: it tries
  the hero with every subset of its image's other photos, or with one photo (per shape, nearest in time) from up to 8
  nearby images in the same moment, and re-arranges everything else from those images with the normal grouping
  (`groupsOf`, sharing one cache, ~0.15 s). The user asked for this over trades/splits: displaced photos go back into
  the pool and find a better home. The re-plan uses `R.strict` (over-max groups cost 50, not 3), never adds images that
  break the rules, and keeps the current arrangement unless another is clearly cheaper (+.05 churn cost). Undo via the
  toast. Auto-arrange respects heroes through the same scoring.
  Rules always win over the hero: with a hero on the page `scoreL` multiplies rule-violation costs by 6, and
  `bestPage` returns the cheapest layout that passes `validPage` when one exists. A gain under 10% reports "as big as
  it can get".
- The portrait rule counts a **square** as a valid partner for a vertical (square + vertical fills 16:9 well). `orient`
  calls a photo square when it is closer to 1:1 than to 3:4 or 4:3 (aspect 0.866–1.155), so near-square photos count.
  The hero target is "fill the height or the width, whichever is larger" with no orientation cut-off. Swept 0.8–1.2 in
  the user's real scenario: 0.88–1.2 reach full height; 0.85 and below are verticals.
- **Bigger photos** (`R.big`, checkbox in the Auto-arrange sheet, kept across presets): `groupCost` adds .5 per photo
  over 2. On a trip-like set it moves the average from ~2.7 to ~2.4 per image; 3s remain where moments have odd counts
  or the portrait rule needs them. A "maximise the smallest photo" variant was benchmarked and was no better.

### Frames: important invariant
Frames **never paint inside photo rects**. Photos are drawn after the frame, and decorations live only in the
padding or the outer moulding. This is what makes reframing possible. Current frames: Plain, Gallery mat (bevel
colour), Wood (tone, moulding width, bevel), Metal (finish, width), Floating (shadow depth), Art deco (line colour,
corners). Polaroid was removed at the user's request. Canvas `shadowBlur` is not affected by transforms, so it is
multiplied by `c.getTransform().a` so the preview matches the export.

### Wall textures
`S.wall` {kind, depth} adds a texture over the background colour (Frame tab, "Wall" row; depth chips appear once a
texture is chosen): Plaster (matches a photo of the user's orange-peel wall), Stucco, Concrete, Linen, Brick, Boards.
Each is a seamless 1024 px height map built in `WALLS`, lit from the top left by `wallTile` and stored as white/black
alpha, so it takes any background colour. Sizes are in export pixels and tuned so a 1:1 crop looks like a real wall on a
65" TV. `wallMip` pre-halves the tile for the small preview to avoid shimmer. It's drawn in `drawBase` before the frame,
saved in state and in the export XMP, and restored by "Reopen an export".

### Location labels
A caption in the bottom border, right-aligned with the photo area, e.g. "Paříž, Francie · červenec 2025". The pure logic is
in its own `/*LABELS-START*/…/*LABELS-END*/` block (unit-tested like the solver): `parsePlaces`, `placeAt`, `czDate`,
`placeText`, `labelText`.
- **Places** come from `places.txt` (offline, ~79k towns, 2.4 MB / 1.1 MB gzipped, cached by the service worker), built
  by `tools/build-places.cjs` from the `all-the-cities` npm package (GeoNames, CC BY 4.0, credited in README). Kept:
  Europe from 1,000 people, world from 15,000 (with a 5,000 cut-off in most of Europe, Plitvice came out as Bosnia because
  the small Croatian towns were missing). The app never reads the place names iOS shows; only GPS. `placeAt` picks the nearest town
  where a town's reach grows with √population (0.012·√pop km), so Prague's outskirts say Praha; over 60 km from anything
  gives the country only. Popular holiday islands (`ISLANDS`, trimmed boxes, Czech names) win over towns: Teide →
  "Tenerife", not "La Guancha". Croatian islands are left out (too close to the mainland for boxes). `EXONYMS` maps common foreign cities to Czech names; countries come from
  `Intl.DisplayNames('cs')`.
- **Loading**: `loadPlaces` reads `#places-data` if the page embeds it (the Claude artifact test build does), else fetches
  `places.txt`. A failed or bogus load (fewer than 1,000 places, e.g. an error page) shows one message and is retried at
  most every 10 s, and right away when a label mode is picked. Before this, a failed first load silently left labels
  date-only for good.
- **Text** (user's choices): Czech month + year ("srpen 2025", ranges "srpen – září 2025"). The label is built from
  four **independent parts per image** (user's request; the old Auto/Date/Place + date/Off modes and Landmark/Town
  switches are gone): landmark, town, country, date (`composeLabel`, flags `pg.lf={l,t,c,d}` over `labelDefaults`:
  date and landmark on, town and country only abroad, since "Praha" on every Prague image says nothing). Places follow
  photo order; with the town on, landmarks gather under their town and the town never repeats ("Staroměstský orloj &
  Karlův most, Praha"); a run of one country shares it ("Paříž & Lyon, Francie"); another country in between repeats
  it. One join rule everywhere: two items "&", three or more " · ". Landmark names are shortened (`shortName`: OSM
  `short_name(:cs)` first, then over ~28 characters cut at the first add-on: " a ", dash, comma, bracket, preposition;
  "Pomník obětem komunismu a přilehlé kaskádové schodiště…" → "Pomník obětem komunismu"), at most two per image.
  **UI**: one wrapping row on the Layout tab (`#labelParts`): a button per part that shows its value even while off
  (on = solid accent, off = dashed), so a long or wrong landmark is visible before switching it on, plus ✎ for typed
  text (`pg.label`; tapping a part leaves typed text). Under the row the full label is shown as text (`#labelText`,
  "No label" when empty), because the caption on the preview is too small to read on a phone held upright. Older sets
  (`pg.lm`, `pg.pl`, `pg.ld`, set-wide `st.labelMode`) are converted by `migrateLabel` on restore.
- **Landmarks online** (user's request, on by default, `S.online` in localStorage): a "Detailed places (online)" toggle
  above the empty-state import square (`#onlTop`, hidden once a set exists) and on the review screen (`#onlRvCb`).
  `poiUrl`/`poiNominatim` (pure, LABELS block) ask **Nominatim reverse** (`nominatim.openstreetmap.org/reverse`, zoom 18,
  `layer=poi,natural,manmade`, `accept-language=cs`) for the nearest point of interest or natural feature, one light GET
  per spot. `POI_OK` lists the category/type pairs that count as landmarks (museum, viewpoint, castle, ruins, monument,
  park, garden, beach, peak, waterfall, lighthouse, national park; protected areas only with protect_class 2); anything
  else (café, shop…) gives no landmark. Accepted when the photo is inside its bounding box (under ~3 km across, any size
  for national parks/reserves/islands) or within ~200 m. Overpass was used first and dropped: even after slimming the
  query (key=value filters, spatial-first `around`, batches) the public servers mostly answered 429 or timed out on the
  user's phone ("no answer" / "server busy" cycling). Trade-off: Nominatim gives only the single nearest feature, so a
  museum 100 m away behind a nearer café is missed. Lakes count (`natural=water` with water=lake/reservoir/lagoon, any size), rivers don't.
  `poiNominatim` also keeps the answer's `address.country_code` and city/town/village (`{v:2,name,cc,town}`): when its
  country differs from the offline nearest town's, `labelPhotos` uses the online country and town (offline has no
  borders: Ross Lake, USA came out as Canada). Cache entries without `v:2` are dropped on load and asked again. The queue (`poiQ`,
  `poiRun`) runs in the background from the moment photos are picked, one spot per request, ≥1.1 s apart (Nominatim's policy is
  1/s), 15 s timeout, back-off 3→6→12…30 s on 429/5xx/offline; only
  coordinates rounded to 3 decimals (~100 m) are sent, and answers are cached in IndexedDB `kv.poi` (a rejected query
  is not cached and shows one message). Progress is a thin bar right above the tab bar with a pin and "3/17" at the far
  left (`#poiBadge`; it first sat on the preview, which hid photos). Filmstrip thumbnails show a pin in the bottom-right
  corner, no backdrop, mostly outside the picture (`geoState`: crossed = no GPS, nothing = lookups off, dark red =
  waiting, green = ready; colours `--geo-no`/`--geo-ok`, used for every pin). Export waits
  up to a minute for pending lookups of the images being exported.
  The landmark part carries the lookup state (`geoState`: green ready, dark red waiting, crossed out without GPS; the
  filmstrip pins use the same states). With online lookups off it reads "Find landmarks" (user's request): it sets
  `pg.on` and queues just that image's photos (`poiEnqueue(…, true)`); `pg.on` is saved and pending lookups resume
  after a restart. The progress bar counts **images** (like the green pins) and shows why it waits ("server busy, retry
  in 20 s"): the user saw 0/38 while 6 images were green, because it counted only new spots. iOS freezes a locked or
  background web app, so lookups can't run then; while they run and the app is open, a screen wake lock keeps the
  phone awake (`poiWake`), and returning to the app cuts the retry wait short (`poiNudge`). Not verified against the live service from the dev container (blocked); tested
  with stand-in answers in Nominatim's jsonv2 format.
- **Drawing**: `drawLabel` in `drawBase`, so previews, thumbnails and exports all get it. Size .3 × padding (.24 for Art
  deco, whose lines run through the border); hidden below ~16 px. Never inside a photo rect.
- **Editing**: ✎ or tapping the bottom-right border on the Layout tab (`inLabel`) → dialog: Save (custom text in
  `pg.label`, locks the image), Automatic (deletes `pg.label`), Cancel. An image with no label (but some part on) shows a
  faint "+ Label" there.
- **Saved** in state (`pg.lf`, `pg.label`, `pg.on`) and in the export XMP (`label`, restored by Reopen). Export metadata is
  now UTF-8 before base64 (btoa threw on Czech letters).
- Verified on the user's iPhone (artifact test page, photo library): 17/17 photos kept GPS.

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
- **Import goes through a review step first** (user's request): a full-screen grid of the new batch (`openReview`,
  `RV.list`, scrolling in `.rvscroll`: with the grid itself as the flex scroller, iOS squashed the rows) where tapping a photo toggles hero, ✕ removes it, and Add picks more. "Arrange N photos" then auto-composes
  (`arrangeNew`) and opens the Auto-arrange sheet (presets + collapsible fine-tune + try another), so rules can be
  changed straight away. Cancel drops only the new batch. `S.importing` stays on during the review so its assets aren't
  purged. Rules are not a tab.
- Tabs: **Layout** (the only place editing gestures work), **Frame** (preview is view-only, no handles or badges),
  **Export**. The tab bar is compact (icon and label inline, reduced bottom safe area). The user wanted tabs that look
  physical: the bar is a darker strip and the selected tab hangs from the page (page colour, side borders, rounded
  bottom, shadow, accent underline); the first tinted-tab attempt wasn't enough.
- No status/info row: messages are a transient pill at the top, and photo actions (replace, crop, reset zoom, remove)
  float above the tab bar when a photo is selected. Delete image = ✕ on the active thumbnail. Undo is via the toast.
- Shuffle and full screen are small stacked buttons at the end of the filmstrip row.
- **Full screen** rotates the image 90° when the phone is upright (works with rotation lock on); `toExp` maps touches
  for the rotated canvas. It has prev/next buttons, a counter and swipe: a horizontal swipe flips images once the photo
  under the finger can't pan further that way, and that photo's pan is reverted.
- Corner badge on each photo shows **which way it can currently be dragged** (↔, ↕ or both), not the photo's original
  orientation. It turns red with "!" when the photo is upscaled (blurry). No badge = can't move.
  A hero shows a matching translucent ★ disc in the bottom-right corner (`heroBadge`), on the Layout tab and behind
  the Auto-arrange sheet; not on the Frame tab or in exports.
- Frame picker is a horizontal scroll row; options for the selected frame appear below it. Background has 5 swatches
  plus a custom colour picker.
- Gestures: drag = pan, pinch = zoom, double-tap = reset (photo or border), hold + drag = swap, or drop on a filmstrip
  thumbnail to move the photo to that image; tap an empty spot to add a photo.
- Minimal text throughout. Remove explanatory copy rather than add it.

## Known issues / open questions
- Verify on a real iPhone: XMP survives Photos; GPS survives the picker (iOS may strip location; time-only fallback
  works); pinch feel; hold delay (380 ms).
- Big imports: the unordered DP's size is the product of (photos per aspect class + 1). `chunksOf` splits each run
  (the whole set for "none", each moment for "medium") into time-contiguous chunks under `STATES` (6000), cutting at the
  biggest gap. 100 photos compose in ~3 s on desktop; 6000 was the best speed/quality trade-off in benchmarks.
- Swap ghost uses the uncropped preview.
- Sending images straight to the TV isn't possible from a browser; SmartThings stays the last step.

## Suggested next steps (agreed direction, not yet built)
1. Warning dots on filmstrip thumbnails (empty spot, blurry photo, rule broken).
2. A **tray** for unused or removed photos, with drag back into any image.
3. Near-duplicate detection on import (perceptual hash); dupes go to the tray.
4. Multiple **sets** (e.g. "Summer trip", "Christmas"), each with its own style and rules; mark exported images and
   re-export only changed ones.
5. Multi-step undo history.
6. **Other screen sizes** (user: "might be needed down the road for other Frameo frames"): 1920 × 1080 (16:9) and
   1920 × 1200 (16:10). Plan agreed: make `W`/`H` a setting (chips on the Frame tab, 4K 16:9 default), replace the five
   CSS `aspect-ratio:16/9` rules and three `9/16` canvas sizings with one variable, re-fit each image's layout on change,
   store the size in the export XMP. Layouts are fractional so the solver needs no changes; rotate layouts 90° if a
   portrait size is ever added. Not started.

## Working conventions
- After any change: `node tests/solver.test.mjs`, and `python tests/e2e_smoke.py` for UI changes. Look at the
  screenshots in `tests/out/`. Several past bugs were only visible there, e.g. CSS `display` overriding `[hidden]`
  (now fixed globally) and a grid item overflowing the header.
- Bump `VERSION` in `sw.js` on every deploy.
- UI copy uses typographic apostrophes and quotes (’ “ ”). Code uses straight quotes.
- Colours are CSS variables with dark-mode overrides; keep new UI on those tokens.
