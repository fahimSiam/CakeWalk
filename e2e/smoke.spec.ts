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

  await page.goto('/?debug=1&seed=11&area=dhanmondi');
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

test('all six areas load and produce runnable routes', async ({ page }) => {
  for (const area of ['uttara', 'bashundhara', 'mohammadpur', 'puran_dhaka', 'gulistan']) {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`/?seed=3&area=${area}`);
    await page.waitForFunction(() => window.__cakewalk?.ready === true);
    await page.waitForFunction(() => Boolean(window.__cakewalk.ctx.testApi.routeSelect));
    await page.evaluate(() => {
      (window.__cakewalk.ctx.testApi.routeSelect as { start(i: number): void }).start(0);
    });
    await page.waitForFunction(() => window.__cakewalk.ctx.machine.activeName === 'run');
    await page.waitForTimeout(250);
    expect(errors, `area ${area}`).toEqual([]);
  }
});

test('menu shows areas/energy and the daily starts without energy cost', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?ftue=0');
  await page.waitForFunction(() => window.__cakewalk?.ready === true);
  await page.waitForFunction(() => window.__cakewalk.ctx.machine.activeName === 'menu');
  await page.screenshot({ path: 'e2e/screenshots/menu.png' });

  const energyBefore = await page.evaluate(() => window.__cakewalk.ctx.save.get().energy.current);
  await page.evaluate(() => {
    (window.__cakewalk.ctx.testApi.menu as { startDaily(): void }).startDaily();
  });
  await page.waitForFunction(() => Boolean(window.__cakewalk.ctx.testApi.routeSelect));
  await page.evaluate(() => {
    (window.__cakewalk.ctx.testApi.routeSelect as { start(i: number): void }).start(0);
  });
  await page.waitForFunction(() => window.__cakewalk.ctx.machine.activeName === 'run');
  const energyAfter = await page.evaluate(() => window.__cakewalk.ctx.save.get().energy.current);
  expect(energyAfter).toBe(energyBefore); // daily is free
  expect(errors).toEqual([]);
});

test('first launch shows the menu with a tutorial card that starts the tutorial', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/'); // fresh storage
  await page.waitForFunction(() => window.__cakewalk?.ready === true);
  // Menu first, always.
  await page.waitForFunction(() => window.__cakewalk.ctx.machine.activeName === 'menu');
  await expect(page.locator('#cw-tutorial')).toBeVisible();
  await expect(page.locator('#cw-play')).toBeVisible();
  await page.click('#cw-tutorial');
  await page.waitForFunction(() => window.__cakewalk.ctx.machine.activeName === 'run', undefined, {
    timeout: 15000,
  });
  expect(errors).toEqual([]);
});

test('crossing minigame opens at a major road and resolves', async ({ page }) => {
  await page.goto('/?seed=7&area=gulistan');
  await page.waitForFunction(() => Boolean(window.__cakewalk.ctx.testApi.routeSelect));
  await page.evaluate(() => {
    const rs = window.__cakewalk.ctx.testApi.routeSelect as {
      routes: { crossings: number }[];
      start(i: number): void;
    };
    let best = 0;
    rs.routes.forEach((r, i) => {
      if (r.crossings > rs.routes[best]!.crossings) best = i;
    });
    rs.start(best);
  });
  await page.waitForFunction(() => window.__cakewalk.ctx.machine.activeName === 'run');
  await page.evaluate(() => {
    window.__cakewalk.loop.timeScale = 0;
    const api = window.__cakewalk;
    const run = api.ctx.testApi.run as {
      player: { health: number };
      traffic: { pendingZone: unknown };
    };
    for (let i = 0; i < 30 * 600 && !run.traffic.pendingZone; i++) {
      api.inject({ speed: 1 });
      api.step(1);
      run.player.health = 100;
    }
    api.step(1); // open the minigame
  });
  await page.waitForSelector('#cw-skip', { timeout: 5000 });
  // Take the overbridge: zone resolves as crossed, run resumes.
  await page.click('#cw-skip');
  await page.waitForSelector('#cw-skip', { state: 'detached', timeout: 5000 });
  const crossed = await page.evaluate(() => {
    const run = window.__cakewalk.ctx.testApi.run as {
      traffic: { zones: { crossed: boolean }[]; pendingZone: unknown };
    };
    return run.traffic.zones.some((z) => z.crossed) && !run.traffic.pendingZone;
  });
  expect(crossed).toBe(true);
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
