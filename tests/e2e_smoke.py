"""Headless smoke test at iPhone size. Catches layout/regression bugs that unit tests can't
(e.g. a stray overlay, CSS overriding [hidden], header overflowing the screen).

Setup once:  pip install playwright pillow && python -m playwright install chromium
Run:         python tests/e2e_smoke.py        (screenshots land in tests/out/)
"""
import asyncio, pathlib, subprocess, sys, time
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'out'; OUT.mkdir(exist_ok=True)

def make_photos():
    cols = ['#c0392b','#2980b9','#27ae60','#8e44ad','#d35400','#16a085','#2c3e50','#f39c12','#7f8c8d','#e84393']
    paths = []
    for i, c in enumerate(cols):
        w, h = (3024, 4032) if i % 3 == 0 else (4032, 3024)
        im = Image.new('RGB', (w, h), c); d = ImageDraw.Draw(im)
        d.ellipse([w//2-500, h//2-500, w//2+500, h//2+500], fill='white')
        p = OUT / f'p{i}.jpg'; im.save(p, quality=80); paths.append(str(p))
    return paths

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1); errors = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            await pg.goto('http://localhost:8765/index.html'); await pg.wait_for_timeout(500)
            assert await pg.is_visible('#emptyBtn'), 'empty state button should show'
            await pg.set_input_files('#importFile', make_photos()); await pg.wait_for_timeout(6000)
            assert not await pg.is_visible('#emptyBtn'), 'empty state must hide after import'
            assert await pg.is_visible('#sheet'), 'auto-arrange sheet opens after import'
            if await pg.is_visible('#tour'): await pg.click('#tourOk')
            await pg.click('#bSheetDone')
            n = await pg.evaluate('S.pages.length'); print('images:', n)
            await pg.screenshot(path=OUT / 'layout.png')
            await pg.click('#bShuffle'); await pg.wait_for_timeout(400); print('shuffle:', await pg.inner_text('#hint'))
            await pg.click('#bFull'); await pg.wait_for_timeout(300); await pg.click('#fsNext'); await pg.wait_for_timeout(200)
            assert await pg.evaluate('S.active') == 1, 'full-screen next should advance'
            await pg.screenshot(path=OUT / 'fullscreen.png'); await pg.click('#bFsClose')
            for t in ['frame', 'export']:
                await pg.click(f'nav.tabbar button[data-t="{t}"]'); await pg.wait_for_timeout(300)
                await pg.screenshot(path=OUT / f'{t}.png')
            hdr = await pg.evaluate("document.querySelector('header.top').scrollWidth<=innerWidth")
            assert hdr, 'header must not overflow horizontally'
            await pg.wait_for_timeout(1200); await pg.reload(); await pg.wait_for_timeout(4000)
            assert await pg.evaluate('S.pages.length') == n, 'set should restore after reload'
            await b.close()
    finally:
        srv.kill()
    assert not errors, errors
    print('smoke test passed; screenshots in', OUT)

asyncio.run(main())
