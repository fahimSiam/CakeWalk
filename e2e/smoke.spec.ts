import { expect, test } from '@playwright/test';

test('boots without console errors and renders frames', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.__cakewalk?.ready === true);

  // Let it render a bit, then confirm the renderer is actually drawing.
  await page.waitForTimeout(500);
  const calls = await page.evaluate(() => window.__cakewalk.renderer.info.render.calls);
  expect(calls).toBeGreaterThan(0);

  const state = await page.evaluate(() => window.__cakewalk.machine.activeName);
  expect(state).toBe('boot');
  expect(errors).toEqual([]);

  await page.screenshot({ path: 'e2e/screenshots/boot.png' });
});
