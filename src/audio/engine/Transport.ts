export class TransportClock {
  private basePositionSec = 0;
  private startedAtContextTime: number | null = null;

  play(contextTime: number, positionSec = this.basePositionSec) {
    this.basePositionSec = Math.max(0, positionSec);
    this.startedAtContextTime = contextTime;
  }

  pause(contextTime: number) {
    const position = this.getPosition(contextTime);
    this.startedAtContextTime = null;
    this.basePositionSec = position;
    return position;
  }

  stop() {
    this.startedAtContextTime = null;
    this.basePositionSec = 0;
  }

  seek(positionSec: number, contextTime?: number) {
    this.basePositionSec = Math.max(0, positionSec);
    if (typeof contextTime === "number" && this.startedAtContextTime !== null) {
      this.startedAtContextTime = contextTime;
    }
  }

  getPosition(contextTime: number) {
    if (this.startedAtContextTime === null) {
      return this.basePositionSec;
    }

    return this.basePositionSec + Math.max(0, contextTime - this.startedAtContextTime);
  }

  get playing() {
    return this.startedAtContextTime !== null;
  }
}
