import { setParam } from './paramUtils';

/**
 * An OscillatorNode whose phase can be restarted. A native oscillator can only start once, so restarting means
 * swapping in a fresh one scheduled for an exact time. The engine uses this so that every free-running modulator
 * begins at phase 0 exactly when playback begins, which is what makes realtime preview and offline export line up.
 */
export class Lfo {
  private oscillator: OscillatorNode;
  private frequency = 1;
  private type: OscillatorType = 'sine';

  constructor(
    private readonly context: BaseAudioContext,
    private readonly targets: readonly (AudioNode | AudioParam)[],
  ) {
    this.oscillator = this.createOscillator();
    this.oscillator.start();
  }

  setFrequency(hz: number, immediate: boolean): void {
    this.frequency = hz;
    setParam(this.context, this.oscillator.frequency, hz, immediate);
  }

  setType(type: OscillatorType): void {
    this.type = type;
    this.oscillator.type = type;
  }

  /** Begin a new cycle at phase 0 at context time `at`. */
  restart(at: number): void {
    const previous = this.oscillator;
    this.oscillator = this.createOscillator();
    this.oscillator.start(at);
    previous.stop(at);
    previous.onended = () => previous.disconnect();
  }

  dispose(): void {
    this.oscillator.onended = null;
    try {
      this.oscillator.stop();
    } catch {
      // Already stopped.
    }
    this.oscillator.disconnect();
  }

  private createOscillator(): OscillatorNode {
    const oscillator = this.context.createOscillator();
    oscillator.type = this.type;
    oscillator.frequency.value = this.frequency;
    for (const target of this.targets) {
      if (target instanceof AudioParam) oscillator.connect(target);
      else oscillator.connect(target);
    }
    return oscillator;
  }
}
