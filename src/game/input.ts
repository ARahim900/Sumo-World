import { neutral, type Intent } from './content';
export class Input {
  keys = new Set<string>(); edges = new Set<string>(); yawDelta = 0; pitchDelta = 0;
  gamepadButtons = new Set<number>();
  /** Reused every frame; read() overwrites every field. */
  private readonly intent = neutral();
  constructor(private element: HTMLElement, private pause: () => void) {
    window.addEventListener('keydown', this.down); window.addEventListener('keyup', this.up); window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility); document.addEventListener('pointerlockchange', this.lockChange);
    element.addEventListener('pointerdown', this.pointer); window.addEventListener('mousemove', this.mouse);
  }
  down = (e: KeyboardEvent) => { if (e.target instanceof HTMLInputElement) return; if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); if (!e.repeat) this.edges.add(e.code); this.keys.add(e.code); };
  up = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  blur = () => { this.clear(); this.pause(); };
  visibility = () => { if (document.hidden) this.blur(); };
  lockChange = () => { if (!document.pointerLockElement) this.blur(); };
  pointer = () => { if (!document.pointerLockElement) this.element.requestPointerLock()?.catch(() => { /* Drag-free keyboard play remains available. */ }); };
  mouse = (e: MouseEvent) => { if (document.pointerLockElement === this.element || e.buttons === 1 && e.target === this.element) { this.yawDelta -= e.movementX * .0025; this.pitchDelta += e.movementY * .002; } };
  take(code: string) { const result = this.edges.has(code); this.edges.delete(code); return result; }
  held(...codes: string[]) { return codes.some(c => this.keys.has(c)); }
  read(): Intent {
    const i = this.intent; i.throttle = +this.held('KeyW', 'ArrowUp'); i.brake = +this.held('KeyS', 'ArrowDown'); i.steer = +this.held('KeyA', 'ArrowLeft') - +this.held('KeyD', 'ArrowRight');
    i.moveX = +this.held('KeyA', 'ArrowLeft') - +this.held('KeyD', 'ArrowRight'); i.moveZ = i.throttle - i.brake;
    i.sprint = this.held('ShiftLeft', 'ShiftRight'); i.handbrake = this.held('Space'); i.jump = this.take('Space');
    const pads = navigator.getGamepads?.() ?? []; const pad = Array.from(pads).find(p => p?.connected && p.mapping === 'standard');
    if (pad) {
      const axis = (n: number) => Math.abs(pad.axes[n] ?? 0) < .15 ? 0 : pad.axes[n];
      i.steer = Math.abs(axis(0)) > .1 ? -axis(0) : i.steer; i.moveX = -axis(0) || i.moveX; i.moveZ = -axis(1) || i.moveZ;
      i.throttle = Math.max(i.throttle, pad.buttons[7]?.value ?? 0); i.brake = Math.max(i.brake, pad.buttons[6]?.value ?? 0); i.handbrake ||= !!pad.buttons[1]?.pressed;
      i.sprint ||= !!pad.buttons[10]?.pressed; this.yawDelta -= axis(2) * .025; this.pitchDelta += axis(3) * .015;
      for (const [button, key] of [[2, 'KeyF'], [9, 'Escape'], [11, 'KeyV'], [0, 'Space']] as const) { if (pad.buttons[button]?.pressed && !this.gamepadButtons.has(button)) this.edges.add(key); }
      this.gamepadButtons = new Set(pad.buttons.flatMap((b, n) => b.pressed ? [n] : []));
    } else if (this.gamepadButtons.size) { this.gamepadButtons.clear(); this.blur(); }
    return i;
  }
  clear() { this.keys.clear(); this.edges.clear(); this.yawDelta = 0; this.pitchDelta = 0; }
  dispose() { window.removeEventListener('keydown', this.down); window.removeEventListener('keyup', this.up); window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility); document.removeEventListener('pointerlockchange', this.lockChange); this.element.removeEventListener('pointerdown', this.pointer); window.removeEventListener('mousemove', this.mouse); }
}
