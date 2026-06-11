import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/EventBus';

describe('EventBus', () => {
  it('delivers queued events only on flush', () => {
    const bus = new EventBus();
    const seen: number[] = [];
    bus.on('takaChanged', (e) => seen.push(e.delta));
    bus.emit('takaChanged', { delta: 5, total: 5, reason: 'test' });
    expect(seen).toEqual([]);
    bus.flush();
    expect(seen).toEqual([5]);
  });

  it('events emitted during flush are deferred to the next flush', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('bump', () => {
      order.push('bump');
      bus.emit('comboBroken', { combo: 3, reason: 'bump' });
    });
    bus.on('comboBroken', () => order.push('comboBroken'));
    bus.emit('bump', { severity: 1, agentIndex: 0 });
    bus.flush();
    expect(order).toEqual(['bump']);
    bus.flush();
    expect(order).toEqual(['bump', 'comboBroken']);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.on('rewindStarted', () => count++);
    bus.emit('rewindStarted', {});
    bus.flush();
    off();
    bus.emit('rewindStarted', {});
    bus.flush();
    expect(count).toBe(1);
  });

  it('clearQueue drops pending events', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('theft', () => count++);
    bus.emit('theft', { amount: 10, source: 'walk' });
    bus.clearQueue();
    bus.flush();
    expect(count).toBe(0);
  });
});
