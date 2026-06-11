/**
 * Top-level game flow: boot → menu → routeSelect → run → results,
 * plus shop / daily / settings. One state active at a time; states own
 * their scene content and UI and clean up on exit.
 */

export interface GameState {
  enter(params?: unknown): void;
  exit(): void;
  fixedUpdate(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class StateMachine {
  private states = new Map<string, GameState>();
  private current: GameState | null = null;
  private currentName = '';

  register(name: string, state: GameState): void {
    this.states.set(name, state);
  }

  transition(name: string, params?: unknown): void {
    const next = this.states.get(name);
    if (!next) throw new Error(`Unknown state: ${name}`);
    this.current?.exit();
    this.currentName = name;
    this.current = next;
    next.enter(params);
  }

  get activeName(): string {
    return this.currentName;
  }

  fixedUpdate(dt: number): void {
    this.current?.fixedUpdate(dt);
  }

  render(alpha: number, frameDt: number): void {
    this.current?.render(alpha, frameDt);
  }
}
