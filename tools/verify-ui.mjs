/**
 * End-to-end smoke test: boots the player in a real browser, plays the demo,
 * searches a catalogue, cues a result, and checks the spectrum is drawing.
 *
 * Run with the Playwright skill's executor:
 *   node ../.hermes/skills/.../playwright-skill/run.js tools/verify-ui.mjs
 *
 * Requires the static server to be up on 127.0.0.1:8000.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

// Prefer a normally installed Playwright (CI, or `npm i -D playwright`); fall
// back to the copy inside this machine's skill directory. ESM ignores
// NODE_PATH, so the fallback is required by absolute path.
const require = createRequire(import.meta.url);
const fallbackModule = process.env.PW_MODULE
  || '/data/home/.hermes/skills/software-development/playwright-skill/node_modules/playwright';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = require(fallbackModule));
}

const BASE = process.env.BASE || 'http://127.0.0.1:8000';

const executablePath = process.env.PW_EXECUTABLE_PATH
  || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  headless: true,
  // This machine has a system Chromium and no Playwright download; CI has the
  // opposite. Pick whichever is actually there.
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('html[data-ready="ready"]', { timeout: 20000 });
  check('boots to data-ready=ready', true);

  // The demo is filed on load, so the crate is never empty.
  const demoCount = await page.locator('.library-item').count();
  check('demo track is filed on load', demoCount === 1, `${demoCount} track(s)`);

  // Art and title are populated.
  const title = await page.locator('#title-text').textContent();
  check('demo title is shown', Boolean(title && title !== 'Nothing cued'), title);

  // The demo ships with an .lrc, so the words should be on the page.
  const lyricLines = await page.locator('#lyrics-lines li').count();
  check('the demo lyrics are parsed and shown', lyricLines > 0, `${lyricLines} lines`);
  check('the lyrics panel is not hidden', await page.locator('#lyrics').isVisible());

  // Play it, and confirm the clock actually moves.
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  const playing = await page.evaluate(() => document.body.classList.contains('is-playing'));
  const firstTick = await page.locator('#time-current').textContent();
  await page.waitForTimeout(900);
  const secondTick = await page.locator('#time-current').textContent();
  check('playback starts', playing, `body.is-playing=${playing}`);
  check('the clock advances', firstTick !== secondTick, `${firstTick} -> ${secondTick}`);

  // The spectrum must be drawing, and it must move with the music.
  const frame = () => page.evaluate(() => {
    const canvas = document.getElementById('visualizer');
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    let strong = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) lit += 1;
      if (data[i] > 180) strong += 1;
    }
    return { lit, strong, signature: data.filter((_, i) => i % 4 === 3).reduce((a, b) => a + b, 0) };
  });
  const still = await frame();
  await page.waitForTimeout(400);
  const moving = await frame();
  check('the spectrum is drawing', still.lit > 200 && still.strong > 40,
    `${still.lit} lit / ${still.strong} strong pixels`);
  check('the spectrum moves with the music', still.signature !== moving.signature,
    `${still.signature} -> ${moving.signature}`);

  // Search Deezer and cue the first result.
  await page.locator('#search').fill('glass animals');
  await page.waitForSelector('.result', { timeout: 25000 });
  const resultCount = await page.locator('.result').count();
  check('Deezer returns results', resultCount > 0, `${resultCount} rows`);

  const before = await page.locator('#title-text').textContent();
  await page.locator('.result').first().click();
  await page.waitForTimeout(2500);
  const after = await page.locator('#title-text').textContent();
  check('cueing a result changes the track', before !== after, `${before} -> ${after}`);

  const crate = await page.locator('.library-item').count();
  check('the cued track joins the running order', crate === 2, `${crate} tracks`);

  // Hero shot: a Web Audio track playing, so the spectrum is live.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'docs/player.png', fullPage: true });

  // NCS plays in HTML5 mode, and the UI says so.
  await page.getByRole('tab', { name: 'NCS' }).click();
  await page.locator('#search').fill('sky');
  await page.waitForTimeout(800);
  const ncsRows = await page.locator('.result').count();
  check('the NCS catalogue is searchable', ncsRows > 0, `${ncsRows} rows`);
  if (ncsRows) {
    await page.locator('.result').first().click();
    await page.waitForTimeout(1500);
    const mode = await page.evaluate(() => document.body.dataset.mode);
    check('NCS is labelled as HTML5 playback', mode === 'html5', `data-mode=${mode}`);
  }

  // The equaliser panel opens and has ten bands.
  await page.locator('#eq-toggle').click();
  const bands = await page.locator('.eq-band').count();
  check('the equaliser has ten bands', bands === 10, `${bands} sliders`);

  // Local files: the picker reads tags and files the track.
  const crateBefore = await page.locator('.library-item').count();
  await page.locator('#file-input').setInputFiles('demo/demo.mp3');
  await page.waitForTimeout(800);
  const crateAfter = await page.locator('.library-item').count();
  const lastTitle = await page.locator('.library-item .library-title').last().textContent();
  check('a dropped file joins the crate', crateAfter === crateBefore + 1, `${crateBefore} -> ${crateAfter}`);
  check('the file\'s tags are read, not its filename', lastTitle === 'Glass', String(lastTitle));

  const fatal = errors.filter((line) => !/favicon|Failed to load resource/i.test(line));
  check('no page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
