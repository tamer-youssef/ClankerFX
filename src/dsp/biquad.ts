/** Direct-form II transposed biquad with RBJ cookbook band-pass coefficients (constant 0 dB peak gain). */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  setBandpass(frequencyHz: number, q: number, sampleRate: number): void {
    const f = Math.min(Math.max(frequencyHz, 10), sampleRate * 0.45);
    const w0 = (2 * Math.PI * f) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Math.max(q, 0.1));
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w0)) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}
