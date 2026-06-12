/**
 * Shared singletons passed to every state. Keeps states constructible and
 * testable without globals.
 */
import type { PerspectiveCamera, WebGLRenderer } from 'three';
import type { StateMachine } from './StateMachine';
import type { SaveSystem } from './SaveSystem';
import type { DebugOverlay } from './DebugOverlay';
import type { InputSystem } from '@/player/Input';
import type { Services } from '@/services';

export interface GameContext {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  machine: StateMachine;
  save: SaveSystem;
  debug: DebugOverlay;
  input: InputSystem;
  services: Services;
  /** Scale the loop's sim time (slow-mo); 1 = normal. */
  loopTimeScale: (scale: number) => void;
  /** Mutable bag exposed on window.__cakewalk for Playwright/dev tooling. */
  testApi: Record<string, unknown>;
}
