const assert = require('node:assert/strict');
const topics = ['Models & Products', 'Agents & Coding', 'Research & Evaluation', 'Infrastructure & Efficiency', 'Safety & Privacy', 'Industry & Society'];

module.exports = async function verifyInteractions(page, concept, record, checkpoint) {
  const reddit = concept === 'reddit';
  const sidebar = page.locator('.sidebar');
  const latest = () => sidebar.getByRole('link', { name: 'Latest', exact: true });
  const waitHeading = async (heading) => page.waitForFunction((text) => document.querySelector('main h1')?.textContent === text, heading);
  const reset = async () => { await latest().click(); await page.waitForFunction(() => !location.hash || location.hash === '#feed'); await waitHeading('Latest'); };
  const checkDetail = async (id) => { await page.waitForFunction((story) => location.hash.includes(`story/${story}`), id); await page.locator(reddit ? '.story-detail' : '.detail').waitFor(); };

  for (const label of topics) {
    await record(`Topic navigation: ${label} -> matching feed`, async () => {
      await sidebar.getByRole('link', { name: label, exact: true }).click();
      await waitHeading(label);
      assert.equal(await page.locator('.story-card').count(), 1);
      assert.equal(await sidebar.getByRole('link', { name: label, exact: true }).getAttribute('aria-current'), 'page');
    });
  }
  await record('Latest navigation -> chronological feed', reset);
  if (reddit) await record('October month -> empty feed; September -> populated feed', async () => {
    await page.locator('#month-select').selectOption('2026-10');
    await page.waitForFunction(() => document.querySelectorAll('.story-card').length === 0);
    assert.match(await page.locator('main').innerText(), /No stories/i);
    await page.locator('#month-select').selectOption('2026-09');
    await page.locator('.story-card').first().waitFor();
  });
  else await record('Feed revisions -> Lucide topics, compact ages, removed heading/month/snapshot/takeaway labels', async () => {
    assert.equal(await page.locator('.topic-icon').count(), 6);
    assert.equal(await page.locator('.topic-symbol').count(), 0);
    assert.equal(await page.locator('#month-select,.month-control,.feed-heading,.snapshot-date,.takeaway-label').count(), 0);
    assert.equal(await page.locator('main h1').getAttribute('class'), 'sr-only');
    assert.doesNotMatch(await page.locator('main').innerText(), /The takeaway|Snapshot:|Article briefs\. Discussion in context\./);
    const ages = await page.locator('.story-meta time').allTextContents();
    assert.equal(ages.length, 3);
    for (const age of ages) assert.match(age, /^(<1h|\d+h|\d+d(?: \d+h)?)$/);
    const formats = await page.evaluate(() => {
      const start = new Date('2026-09-25T12:00:00').getTime();
      return [0, .5, 23, 24, 26, 48].map(hours => ageLabel('2026-09-25', start + hours * 3600000));
    });
    assert.deepEqual(formats, ['<1h', '<1h', '23h', '1d', '1d 2h', '2d']);
    const spacing = await page.evaluate(() => {
      const card = document.querySelector('.story-card');
      return { gap: card.getBoundingClientRect().top - document.querySelector('.site-header').getBoundingClientRect().bottom, top: getComputedStyle(card).paddingTop };
    });
    assert.equal(spacing.gap, 32);
    assert.equal(spacing.top, '32px');
  });
  await record('Load more -> all six preview stories and end-of-feed feedback', async () => {
    await page.getByRole('button', { name: 'Load more stories', exact: true }).click();
    assert.equal(await page.locator('.story-card').count(), 6);
    assert.match(await page.locator('main').innerText(), /end of|up to date/i);
  });

  const storyLinks = await page.locator('.story-card h2 a').evaluateAll((links) => links.map((link) => ({ href: link.getAttribute('href'), title: link.textContent })));
  for (const story of storyLinks) {
    const id = story.href.split('/')[1];
    await record(`Story headline: ${story.title} -> article brief; Back -> preserved feed`, async () => {
      await page.locator(`.story-card h2 a[href="${story.href}"]`).click();
      await checkDetail(id);
      assert.match(await page.locator('main').innerText(), /Article brief/);
      if (id === '49849985') await checkpoint('story-detail');
      await page.goBack();
      await page.locator('.story-card').first().waitFor();
      assert.equal(await page.locator('.story-card').count(), 6);
    });
  }

  await record('Discussion analysis -> existing discussion section', async () => {
    await page.locator('.story-card').first().getByRole('link', { name: 'Discussion analysis', exact: true }).click();
    await checkDetail('49849985');
    await page.waitForTimeout(150);
    const target = page.locator(reddit ? '#discussion' : '#discussion-analysis');
    await target.waitFor();
    assert.match(await target.innerText(), /skepticism|split/i);
    await checkpoint('discussion');
  });
  await record('Original source and HN links -> verified captured story destinations', async () => {
    assert.equal(await page.locator('main a[href="https://swarmtraces.org/"]').count(), 1);
    assert.equal(await page.locator('main a[href="https://news.ycombinator.com/item?id=49849985"]').count(), 1);
    // Intercept external navigation, activate each link, and verify its real target without fetching it.
    for (const url of ['https://swarmtraces.org/', 'https://news.ycombinator.com/item?id=49849985']) {
      await page.context().route(url, (route) => route.fulfill({ status: 200, body: '<title>Verified external destination</title>' }));
      const popupPromise = page.waitForEvent('popup');
      await page.locator(`main a[href="${url}"]`).click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(popup.url(), url);
      await popup.close();
    }
  });
  await record('Related story -> next existing story view', async () => {
    await page.locator(reddit ? '.related-story' : '.related-list a').first().click();
    await checkDetail('sample-agents');
    assert.match(await page.locator('main').innerText(), /Sample story|Sample discussion/);
  });
  await record('Discussion themes -> keyboard-operable existing accordion', async () => {
    const theme = page.locator(reddit ? '.theme-list details' : '.themes details').first();
    await theme.waitFor();
    await theme.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await theme.getAttribute('open'), '');
    await page.keyboard.press('Enter');
    assert.equal(await theme.getAttribute('open'), null);
  });
  await record('Skip link on a story -> current content; preserves the story view', async () => {
    const title = await page.locator('main h1').innerText();
    await page.locator('.skip').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
    assert.equal(await page.locator('main h1').innerText(), title);
  });
  if (!reddit) {
    await record('Story section navigation -> brief and discussion anchors', async () => {
      await page.getByRole('navigation', { name: 'Story sections' }).getByRole('link', { name: 'Article brief', exact: true }).click();
      await page.locator('#article-brief').waitFor();
      await page.getByRole('navigation', { name: 'Story sections' }).getByRole('link', { name: 'Discussion analysis', exact: true }).click();
      await page.locator('#discussion-analysis').waitFor();
    });
  }

  const shareDialog = page.locator('#share-dialog');
  await record('Share -> editable existing suggested post; Escape -> returns focus', async () => {
    await page.locator('main [data-share]').first().click();
    await shareDialog.waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('#share-dialog').contains(document.activeElement)), true);
    await checkpoint('share-dialog');
    await page.locator(reddit ? '#share-post' : '#suggested-post').fill('Edited sample post');
    await page.keyboard.press('Escape');
    assert.equal(await shareDialog.isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.matches('[data-share]')), true);
  });
  await record('Copy post and copy link -> clipboard-unavailable manual fallback', async () => {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    await page.locator('main [data-share]').first().click();
    await page.locator(reddit ? '#share-post' : '#suggested-post').fill('Edited sample post');
    await page.locator('#copy-post').click();
    assert.match(await page.locator(reddit ? '#copy-status' : '#share-status').innerText(), /copy|clipboard|select|manual/i);
    if (!reddit) assert.equal(await page.locator('#manual-text').inputValue(), 'Edited sample post');
    await page.locator('#copy-link').click();
    if (!reddit) assert.match(await page.locator('#manual-text').inputValue(), /#story\/sample-agents/);
    await page.locator('#close-share').click();
    assert.equal(await shareDialog.isVisible(), false);
  });
  await record('Copy post and copy link -> mocked clipboard success feedback', async () => {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.__mockClipboard = value; } } }));
    await page.locator('main [data-share]').first().click();
    await page.locator(reddit ? '#share-post' : '#suggested-post').fill('Verified suggested post');
    await page.locator('#copy-post').click();
    assert.equal(await page.evaluate(() => window.__mockClipboard), 'Verified suggested post');
    await page.locator('#copy-link').click();
    assert.match(await page.evaluate(() => window.__mockClipboard), /#story\/sample-agents/);
    await page.keyboard.press('Escape');
  });
  await reset();
  await record('Most read -> existing story; browser Back -> feed', async () => {
    await page.locator(reddit ? '.rail-story' : '.most-read a').first().click();
    await page.locator(reddit ? '.story-detail' : '.detail').waitFor();
    await page.goBack();
    await page.locator('.story-card').first().waitFor();
  });
  await record('About navigation -> existing product explanation; wordmark -> Latest', async () => {
    await page.getByRole('link', { name: 'About', exact: true }).first().click();
    await waitHeading('About Hacksnap');
    await page.locator(reddit ? '.wordmark' : '.brand').click();
    await waitHeading('Latest');
  });

  for (const value of ['loading', 'empty', 'error', 'ready']) {
    await record(`Preview QA: ${value} -> corresponding data state`, async () => {
      await page.getByText('Preview states', { exact: true }).click();
      if (reddit) await page.locator(`[data-state="${value}"]`).click();
      else { await page.locator('#preview-state').selectOption(value); await page.locator('.qa summary').click(); }
      if (value === 'ready') await page.locator('.story-card').first().waitFor();
      else assert.match(await page.locator('main').innerText(), new RegExp(value === 'loading' ? 'Loading' : value === 'empty' ? 'No stories' : 'could not|couldn’t|unavailable', 'i'));
      await checkpoint(value);
    });
    if (value === 'error') {
      await record('Error retry -> populated feed', async () => {
        await page.getByRole('button', { name: /Retry|Try again/ }).click();
        await page.locator('.story-card').first().waitFor();
      });
    }
  }

  await page.setViewportSize({ width: 320, height: 800 });
  await record('Mobile topics menu -> opens, topic selection works, Escape closes', async () => {
    const toggle = page.locator(reddit ? '#browse-toggle' : '#menu-button');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await sidebar.getByRole('link', { name: 'Agents & Coding', exact: true }).click();
    await waitHeading('Agents & Coding');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  });
  await record('Keyboard focus -> visible outline; skip link -> main content', async () => {
    await page.goto(page.url().split('#')[0]);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => ({ text: document.activeElement.textContent.trim(), outline: getComputedStyle(document.activeElement).outlineStyle }));
    assert.match(focused.text, /Skip/i);
    assert.notEqual(focused.outline, 'none');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  });
};
