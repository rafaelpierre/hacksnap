const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '../../../..');
const web = root + '/hacksnap/web';
const swc = require(web + '/node_modules/@swc/core');
const React = require(web + '/node_modules/react');
const { renderToStaticMarkup } = require(web + '/node_modules/react-dom/server');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(web + '/app/browse-loading.tsx', 'utf8').replace('import styles from "./browse-loading.module.css";', 'const styles = new Proxy({}, { get: (_, name) => name });');
const output = swc.transformSync(source, { jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' } }).code;
const moduleObject = { exports: {} };
new Function('module', 'exports', 'React', output)(moduleObject, moduleObject.exports, React);
const markup = renderToStaticMarkup(React.createElement(moduleObject.exports.BrowseLoading));
const css = fs.readFileSync(web + '/app/globals.css', 'utf8') + fs.readFileSync(web + '/app/browse-loading.module.css', 'utf8');
(async () => {
  const browser = await chromium.launch({headless:true});
  const results = [];
  try {
    for (const width of [320,1280]) for (const theme of ['light','dark']) for (const text of [100,200]) {
      const page = await browser.newPage({viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'});
      await page.setContent(`<html data-theme="${theme}" style="font-size:${text}%"><head><style>${css}</style></head><body><main>${markup}</main></body></html>`);
      const measured = await page.locator('article').first().evaluate(el => {
        const rect = e => {const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
        return {title:rect(el.querySelector(':scope > h3')), image:rect(el.querySelector('.feed-story-image')), copy:rect(el.querySelector('.story-content')), overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert(!measured.overflow);
      if (width===320) { assert(measured.title.bottom<=measured.image.top+1); assert(measured.image.bottom<=measured.copy.top+1); }
      else { assert(measured.title.left>=measured.image.right-1); assert(measured.copy.left>=measured.image.right-1 || measured.copy.top>=measured.image.bottom-1); }
      results.push({width,theme,text,...measured});
      await page.close();
    }
    fs.writeFileSync(require('node:path').join(__dirname, 'skeleton-results.json'), JSON.stringify(results,null,2)+'\n');
    console.log(JSON.stringify({cases:results.length,passed:true}));
  } finally {await browser.close();}
})();
