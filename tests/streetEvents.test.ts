import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/EventBus';
import { Rng } from '@/core/Rng';
import { StreetEvents } from '@/world/StreetEvents';

const DT = 1 / 30;

function run(seconds: number, ev: StreetEvents): void {
  for (let i = 0; i < seconds / DT; i++) ev.fixedUpdate(DT);
}

describe('StreetEvents', () => {
  it('stays idle early, then telegraphs and activates an event', () => {
    const bus = new EventBus();
    const phases: string[] = [];
    bus.on('streetEvent', (e) => phases.push(`${e.kind}:${e.phase}`));
    const ev = new StreetEvents(new Rng(3).stream('events'), bus);

    expect(ev.active).toBe(false);
    run(15, ev); // before the earliest event
    bus.flush();
    expect(ev.activeKind).toBeNull();

    run(45, ev); // long enough to warn → activate → end at least once
    bus.flush();
    expect(phases.some((p) => p.endsWith(':warn'))).toBe(true);
    expect(phases.some((p) => p.endsWith(':active'))).toBe(true);
    // Modifiers are sane.
    expect(ev.speedMul).toBeGreaterThan(0);
    expect(ev.speedMul).toBeLessThanOrEqual(1);
    expect(ev.darkness).toBeGreaterThanOrEqual(0);
  });

  it('disabled never fires an event', () => {
    const bus = new EventBus();
    let fired = 0;
    bus.on('streetEvent', () => fired++);
    const ev = new StreetEvents(new Rng(1).stream('events'), bus, false);
    run(120, ev);
    bus.flush();
    expect(fired).toBe(0);
    expect(ev.active).toBe(false);
  });

  it('snapshot/restore round-trips the event state', () => {
    const bus = new EventBus();
    const a = new StreetEvents(new Rng(7).stream('events'), bus);
    run(35, a); // get it into some mid-event state
    const buf = new Float64Array(StreetEvents.SNAP_FLOATS);
    a.snapshot(buf, 0);

    const b = new StreetEvents(new Rng(99).stream('events'), bus);
    b.restore(buf, 0);
    const out = new Float64Array(StreetEvents.SNAP_FLOATS);
    b.snapshot(out, 0);
    expect(Array.from(out)).toEqual(Array.from(buf));
    expect(b.active).toBe(a.active);
  });
});
