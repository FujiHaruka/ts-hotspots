export class Animal {
  private name: string;
  constructor(name: string) {
    this.name = name;
  }
  speak(): string {
    return `${this.name} makes a sound`;
  }
}
