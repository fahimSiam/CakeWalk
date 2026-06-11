import { expect, test } from '@playwright/test';

test('graybox run boots without console errors and renders frames', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?debug=1&seed=7&graybox=1');
  await page.waitForFunction(() => window.__cakewalk?.ready === true);
  await page.waitForTimeout(500);

  const calls = await page.evaluate(() => window.__cakewalk.ctx.renderer.info.render.calls);
  expect(calls).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__cakewalk.ctx.machine.activeName)).toBe('run');
  expect(errors).toEqual([]);
});

test('route select shows Dhanmondi routes and starts a real run', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?debug=1&seed=11');
  await page.waitForFunction(() => window.__cakewalk?.ready === true);
  await page.waitForFunction(() => Boolean(window.__cakewalk.ctx.testApi.routeSelect));

  const routes = await page.evaluate(() => {
    const rs = window.__cakewalk.ctx.testApi.routeSelect as {
      routes: { lengthM: number; crowd: number; crossings: number }[];
    };
    return rs.routes;
  });
  expect(routes.length).toBeGreaterThanOrEqual(2);
  expect(routes[0]!.lengthM).toBeGreaterThan(400);
  await page.screenshot({ path: 'e2e/screenshots/route-select.png' });

  await page.evaluate(() => {
    const rs = window.__cakewalk.ctx.testApi.routeSelect as { start(i: number): void };
    rs.start(0);
  });
  await page.waitForFunction(() => window.__cakewalk.ctx.machine.activeName === 'run');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'e2e/screenshots/run-dhanmondi.png' });
  expect(errors).toEqual([]);
});

test('player advances and earns taka with injected sprint input', async ({ page }) => {
  await page.goto('/?seed=7&graybox=1');
  await page.waitForFunction(() => window.__cakewalk?.ready === true);
  await page.evaluate(() => {
    window.__cakewalk.loop.timeScale = 0;
  });
  const before = await page.evaluate(() => {
    const run = window.__cakewalk.ctx.testApi.run as { player: { s: number } };
    return run.player.s;
  });
  await page.evaluate(() => {
    for (let i = 0; i < 150; i++) {
      window.__cakewalk.inject({ speed: 1 });
      window.__cakewalk.step(1);
    }
  });
  const after = await page.evaluate(() => {
    const run = window.__cakewalk.ctx.testApi.run as {
      player: { s: number; stamina: number };
      score: { taka: number };
    };
    return { s: run.player.s, taka: run.score.taka, stamina: run.player.stamina };
  });
  expect(after.s).toBeGreaterThan(before + 15);
  expect(after.taka).toBeGreaterThan(0);
  expect(after.stamina).toBeLessThan(100);
});
