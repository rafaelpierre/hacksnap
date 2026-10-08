const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const requireWeb = createRequire(path.resolve(__dirname, '../../../../hacksnap/web/package.json'));
const { chromium } = requireWeb('@playwright/test');
const assert = require('node:assert/strict');
const folder = __dirname;
const results = { method: 'Chromium, direct file:// URLs; no web server', date: '2026-10-08', layouts: [], interactions: [], consoleErrors: [] };

async function inspectLayout(page, concept, width, enlarged) {
  await page.setViewportSize({ width, height: 1000 });
  await page.evaluate((zoom) => { document.documentElement.style.fontSize = zoom ? '200%' : ''; }, enlarged);
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => {
    const visible = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    const shortControls = [...document.querySelectorAll('a, button, select, summary, input, textarea')].filter(visible).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width < 43.5 || rect.height < 43.5;
    }).map((el) => ({ tag: el.tagName, label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 80), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
    const clippedText = [...document.querySelectorAll('h1,h2,h3,p,button,summary,select')].filter(visible).filter((el) => !el.classList.contains('sr-only')).filter((el) => {
      const css = getComputedStyle(el);
      return ['hidden', 'clip'].includes(css.overflowY) && el.scrollHeight > el.clientHeight + 2;
    }).map((el) => el.textContent.trim().slice(0, 80));
    function channels(value) {
      const parts = value.match(/[\d.]+/g)?.map(Number) || [];
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] === undefined ? 1 : parts[3]];
    }
    function background(el) {
      if (!el) return [255, 255, 255];
      const own = channels(getComputedStyle(el).backgroundColor);
      if (own[3] === 1) return own.slice(0, 3);
      const behind = background(el.parentElement);
      return own.slice(0, 3).map((value, index) => value * own[3] + behind[index] * (1 - own[3]));
    }
    function luminance(rgb) {
      const linear = rgb.map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }
    const contrastFailures = [];
    let checkedTextPairs = 0;
    for (const el of [...document.querySelectorAll('body *')].filter(visible)) {
      const directText = [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').trim();
      if (!directText || el.closest('svg,script,style,option,[aria-hidden="true"]')) continue;
      const css = getComputedStyle(el);
      const fontSize = parseFloat(css.fontSize);
      const required = fontSize >= 24 || (fontSize >= 18.66 && parseInt(css.fontWeight, 10) >= 700) ? 3 : 4.5;
      const foreground = luminance(channels(css.color).slice(0, 3));
      const behind = luminance(background(el));
      const ratio = (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
      checkedTextPairs++;
      if (ratio + 0.01 < required) contrastFailures.push({ text: directText.slice(0, 60), ratio: Number(ratio.toFixed(2)), required, color: css.color, background: background(el) });
    }
    const overflowElements = [...document.querySelectorAll('body *')].filter(visible).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1;
    }).map((el) => ({ tag: el.tagName, className: typeof el.className === 'string' ? el.className : '', text: el.textContent.trim().slice(0, 45), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })).slice(0, 20);
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, shortControls, clippedText, checkedTextPairs, contrastFailures, overflowElements };
  });
  results.layouts.push({ concept, width, textSize: enlarged ? '200%' : '100%', ...layout });
  assert.ok(layout.documentWidth <= width, `${concept} overflow at ${width}px, ${enlarged ? 200 : 100}% text: ${JSON.stringify(layout.overflowElements)}`);
  assert.deepEqual(layout.shortControls, [], `${concept} undersized controls at ${width}`);
  assert.deepEqual(layout.clippedText, [], `${concept} clipped text at ${width}`);
  assert.deepEqual(layout.contrastFailures, [], `${concept} low text contrast at ${width}`);
}

async function record(page, concept, label, action) {
  await action();
  results.interactions.push({ concept, action: label, status: 'PASS' });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const concept of (process.env.MOCK_CONCEPT ? [process.env.MOCK_CONCEPT] : ['reddit', 'dev'])) {
      const page = await browser.newPage();
      page.on('pageerror', (error) => results.consoleErrors.push({ concept, message: error.message }));
      page.on('console', (message) => { if (message.type() === 'error') results.consoleErrors.push({ concept, message: message.text() }); });
      await page.goto(`file://${path.join(folder, `${concept}.html`)}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350);
      for (const width of [320, 375, 414, 768, 1024, 1440]) await inspectLayout(page, concept, width, false);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: path.join(folder, `${concept}-desktop.png`) });
      await page.setViewportSize({ width: 375, height: 900 });
      await page.screenshot({ path: path.join(folder, `${concept}-mobile.png`), fullPage: true });
      for (const width of [320, 768, 1440]) await inspectLayout(page, concept, width, true);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      await page.setViewportSize({ width: 1440, height: 1000 });

      // Each mock's feature-level click-through is defined after inspecting its DOM.
      if (process.env.MOCK_LAYOUT_ONLY !== '1') {
        const interactionModule = require(path.join(folder, 'verify-interactions.cjs'));
        await interactionModule(page, concept, (label, action) => record(page, concept, label, action), async (state) => {
          for (const [width, enlarged] of [[320, false], [320, true], [1440, false]]) await inspectLayout(page, `${concept}:${state}`, width, enlarged);
        });
      }
      await page.close();
    }
    assert.deepEqual(results.consoleErrors, [], 'Browser console/page errors');
    results.status = process.env.MOCK_LAYOUT_ONLY === '1' ? 'LAYOUT_PASS' : 'PASS';
    fs.writeFileSync(path.join(folder, 'verification.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ status: results.status, layoutChecks: results.layouts.length, interactionChecks: results.interactions.length, consoleErrors: results.consoleErrors.length }));
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  results.status = 'FAIL';
  results.failure = error.message;
  fs.writeFileSync(path.join(folder, 'verification.json'), JSON.stringify(results, null, 2));
  console.error(error.message);
  process.exitCode = 1;
});
