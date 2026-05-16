import { EventEmitter } from "node:events";
import { nowIso } from "../utils/id.js";
import type { RuntimeEvent } from "../types.js";

export class EventBus {
  private readonly emitter = new EventEmitter();

  publish(type: string, payload: unknown): void {
    const event: RuntimeEvent = {
      type,
      payload,
      createdAt: nowIso(),
    };
    this.emitter.emit(type, event);
    this.emitter.emit("*", event);
  }

  on(type: string, listener: (event: RuntimeEvent) => void): void {
    this.emitter.on(type, listener);
  }
}
