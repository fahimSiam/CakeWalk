/**
 * Typed publish/subscribe event bus.
 *
 * Sim systems emit during a fixed tick; UI/audio/economy listeners run when
 * the queue is flushed after the tick. This keeps simulation side-effect-free
 * within a step (important for rewind determinism) while still letting
 * presentation react to everything.
 */

export interface GameEvents {
  bump: { severity: number; agentIndex: number };
  nearMiss: { distance: number; combo: number };
  comboBroken: { combo: number; reason: 'bump' | 'stumble' | 'misread' };
  takaChanged: { delta: number; total: number; reason: string };
  theft: { amount: number; source: 'walk' | 'phone' | 'seated' };
  theftSpotted: { bonus: number };
  stareMisread: Record<string, never>;
  healthChanged: { delta: number; hp: number };
  staminaEmpty: Record<string, never>;
  restStarted: { kind: 'chaDokan' | 'busStop' };
  restEnded: Record<string, never>;
  fruitGrabbed: { kind: string; points: number };
  crossingEntered: { roadId: number };
  crossingResolved: { method: 'direct' | 'overbridge'; bonus: number };
  vehicleHit: { vehicleKind: string };
  rewindStarted: Record<string, never>;
  rewindFinished: Record<string, never>;
  phoneCheckStarted: Record<string, never>;
  phoneCheckEnded: Record<string, never>;
  dogBark: { x: number; z: number };
  catStumble: Record<string, never>;
  cowStampede: Record<string, never>;
  microEvent: { kind: string };
  runFinished: { success: boolean };
  cakewalkMeterFull: Record<string, never>;
}

export type EventName = keyof GameEvents;

type Handler<K extends EventName> = (payload: GameEvents[K]) => void;

interface Queued {
  name: EventName;
  payload: GameEvents[EventName];
}

export class EventBus {
  private handlers = new Map<EventName, Set<Handler<EventName>>>();
  private queue: Queued[] = [];

  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(fn as Handler<EventName>);
    return () => set!.delete(fn as Handler<EventName>);
  }

  /** Queue an event; delivered on the next flush (after the sim tick). */
  emit<K extends EventName>(name: K, payload: GameEvents[K]): void {
    this.queue.push({ name, payload });
  }

  /** Deliver queued events. Called once per sim tick, after all systems. */
  flush(): void {
    // Swap before iterating so handlers emitting new events queue for next flush.
    const batch = this.queue;
    this.queue = [];
    for (const { name, payload } of batch) {
      const set = this.handlers.get(name);
      if (!set) continue;
      for (const fn of set) fn(payload);
    }
  }

  /** Drop queued events (used when restoring a rewind snapshot). */
  clearQueue(): void {
    this.queue.length = 0;
  }
}
