/** A shared process budget across payload kinds. Image-specific limits reserve
 * room for numeric traffic, while neither route can exceed the total budget. */
export class IngestAdmission {
  private active = 0;
  constructor(private readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error("Invalid ingestion admission limit");
  }
  acquire(): (() => void) | null {
    if (this.active >= this.maximum) return null;
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}
