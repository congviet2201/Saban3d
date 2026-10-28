import { RotationDirection } from "../types/viewer";

export interface InputCallbacks {
  onDragStart: (x: number, y: number) => void;
  onDragMove: (deltaX: number, currentX: number, direction: RotationDirection) => void;
  onDragEnd: (finalX: number) => void;
}

export class InputController {
  private element: HTMLElement | null = null;
  private callbacks: InputCallbacks | null = null;
  private isPointerDown = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private hasMovedDrag = false;
  private activePointerId: number | null = null;
  private pixelsPerFrame: number = 7;

  private handlePointerDownBound = this.handlePointerDown.bind(this);
  private handlePointerMoveBound = this.handlePointerMove.bind(this);
  private handlePointerUpBound = this.handlePointerUp.bind(this);
  private handlePointerCancelBound = this.handlePointerCancel.bind(this);
  private handleContextMenuBound = (e: MouseEvent) => e.preventDefault();

  constructor(pixelsPerFrame: number = 7) {
    this.pixelsPerFrame = pixelsPerFrame;
  }

  public getSensitivity(): number {
    return this.pixelsPerFrame;
  }

  public setSensitivity(pixelsPerFrame: number): void {
    this.pixelsPerFrame = Math.max(2, pixelsPerFrame);
  }

  public attach(element: HTMLElement, callbacks: InputCallbacks): void {
    this.detach();

    this.element = element;
    this.callbacks = callbacks;

    element.style.touchAction = "none";
    element.style.userSelect = "none";
    element.style.webkitUserSelect = "none";

    element.addEventListener("pointerdown", this.handlePointerDownBound, { passive: false });
    window.addEventListener("pointermove", this.handlePointerMoveBound, { passive: false });
    window.addEventListener("pointerup", this.handlePointerUpBound, { passive: false });
    window.addEventListener("pointercancel", this.handlePointerCancelBound, { passive: false });
    element.addEventListener("contextmenu", this.handleContextMenuBound);
  }

  public detach(): void {
    if (this.element) {
      this.element.removeEventListener("pointerdown", this.handlePointerDownBound);
      this.element.removeEventListener("contextmenu", this.handleContextMenuBound);
      this.element = null;
    }

    window.removeEventListener("pointermove", this.handlePointerMoveBound);
    window.removeEventListener("pointerup", this.handlePointerUpBound);
    window.removeEventListener("pointercancel", this.handlePointerCancelBound);

    this.callbacks = null;
    this.isPointerDown = false;
    this.hasMovedDrag = false;
    this.activePointerId = null;
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === "mouse") return;

    this.isPointerDown = true;
    this.activePointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.lastX = e.clientX;
    this.hasMovedDrag = false;

    if (this.element && "setPointerCapture" in this.element) {
      try {
        this.element.setPointerCapture(e.pointerId);
      } catch {
        // Safe ignore
      }
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.isPointerDown) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    if (!this.hasMovedDrag) {
      const dist = Math.hypot(currentX - this.startX, currentY - this.startY);
      if (dist < 4) return;
      this.hasMovedDrag = true;
      if (this.callbacks) {
        this.callbacks.onDragStart(this.startX, this.startY);
      }
    }

    e.preventDefault();

    const deltaX = currentX - this.lastX;
    if (deltaX === 0) return;

    const direction: RotationDirection = deltaX < 0 ? "cw" : "ccw";
    this.lastX = currentX;

    if (this.callbacks) {
      this.callbacks.onDragMove(deltaX, currentX, direction);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.isPointerDown) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

    this.isPointerDown = false;

    if (this.element && this.activePointerId !== null && "releasePointerCapture" in this.element) {
      try {
        this.element.releasePointerCapture(this.activePointerId);
      } catch {
        // Safe ignore
      }
    }
    this.activePointerId = null;

    if (this.hasMovedDrag) {
      this.hasMovedDrag = false;
      if (this.callbacks) {
        this.callbacks.onDragEnd(e.clientX);
      }
    }
  }

  private handlePointerCancel(e: PointerEvent): void {
    this.handlePointerUp(e);
  }
}
