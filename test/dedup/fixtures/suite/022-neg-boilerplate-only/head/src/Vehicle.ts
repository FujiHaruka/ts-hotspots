export class Vehicle {
  private kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }
  move(distance: number): string {
    return `${this.kind} moved ${String(distance)} km`;
  }
  stop(): void {
    return;
  }
}
