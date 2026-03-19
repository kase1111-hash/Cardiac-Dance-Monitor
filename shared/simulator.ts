/**
 * Simulation mode — generates synthetic PPI streams for the five validated
 * rhythm dances. Used as the primary development/testing environment.
 *
 * Each scenario produces PPI values (in ms) that, when fed through the torus
 * pipeline, should yield the expected dance identification.
 */

export type RhythmScenario = 'nsr' | 'chf' | 'af' | 'pvc' | 'transition';

interface SimulatorConfig {
  scenario: RhythmScenario;
  /** Beats per minute (overrides scenario default if provided) */
  bpm?: number;
}

/**
 * Generates a stream of synthetic PPI values for a given rhythm scenario.
 * Call next() to get the next PPI value in milliseconds.
 */
export class RhythmSimulator {
  private scenario: RhythmScenario;
  private basePpi: number;
  private beatIndex: number = 0;
  private transitionBeat: number = 100; // beat at which transition scenario switches
  private pvcState: 'normal' | 'pause' = 'normal'; // PVC state machine

  constructor(config: SimulatorConfig) {
    this.scenario = config.scenario;
    this.basePpi = config.bpm ? Math.round(60000 / config.bpm) : this.getDefaultPpi();
  }

  private getDefaultPpi(): number {
    switch (this.scenario) {
      case 'nsr': return 800;       // ~75 BPM
      case 'chf': return 750;       // ~80 BPM
      case 'af': return 700;        // ~86 BPM average (highly variable)
      case 'pvc': return 850;       // ~71 BPM
      case 'transition': return 800; // starts NSR
    }
  }

  /**
   * Returns the next simulated PPI value in milliseconds.
   */
  next(): number {
    this.beatIndex++;
    switch (this.scenario) {
      case 'nsr': return this.simulateNSR();
      case 'chf': return this.simulateCHF();
      case 'af': return this.simulateAF();
      case 'pvc': return this.simulatePVC();
      case 'transition': return this.simulateTransition();
    }
  }

  /**
   * Returns the current beat index.
   */
  getBeatIndex(): number {
    return this.beatIndex;
  }

  /**
   * NSR (Normal Sinus Rhythm) → "The Waltz"
   * Moderate variability, centered around baseline.
   * Produces κ ≈ 10.7, Gini ≈ 0.39, spread ≈ 1.0
   */
  private simulateNSR(): number {
    // Moderate HRV: ±5-8% variation with respiratory sinus arrhythmia
    const respiratoryPhase = Math.sin(this.beatIndex * 0.4) * 0.05;
    const noise = (Math.random() - 0.5) * 0.06;
    return Math.round(this.basePpi * (1 + respiratoryPhase + noise));
  }

  /**
   * CHF (→ "The Lock-Step")
   * Very low variability, metronomic rhythm.
   * Produces κ ≈ 24.0, Gini ≈ 0.35, spread ≈ 0.4
   */
  private simulateCHF(): number {
    // Minimal HRV: ±1-2% variation
    const noise = (Math.random() - 0.5) * 0.02;
    return Math.round(this.basePpi * (1 + noise));
  }

  /**
   * AF (→ "The Mosh Pit")
   * Highly irregular — rapid bursts interspersed with pauses.
   * The alternation between fast clusters and slow beats creates variable curvature.
   * Produces κ ≈ 3.3, Gini ≈ 0.51, spread ≈ 2.0
   */
  private simulateAF(): number {
    // AF has completely irregular ventricular response.
    // Model as: base interval with large multiplicative noise,
    // plus occasional very short bursts (rapid ventricular response)
    // and occasional long pauses.
    const r = Math.random();
    if (r < 0.2) {
      // Fast burst: 350-500ms (120-170 BPM)
      return Math.round(350 + Math.random() * 150);
    } else if (r < 0.35) {
      // Slow response: 900-1300ms (46-67 BPM)
      return Math.round(900 + Math.random() * 400);
    } else {
      // Variable middle range: 500-900ms
      return Math.round(500 + Math.random() * 400);
    }
  }

  /**
   * PVC pattern (→ "The Stumble")
   * Mostly regular rhythm with randomly occurring premature beats (~15% of beats).
   * PVCs create isolated high-curvature events amid low-curvature normal beats,
   * producing very high Gini (curvature inequality).
   * Produces κ ≈ 1.2, Gini ≈ 0.57, spread ≈ 2.5
   */
  private simulatePVC(): number {
    const noise = (Math.random() - 0.5) * 0.04;

    // Track state: after a PVC, next beat is the compensatory pause
    if (this.pvcState === 'pause') {
      this.pvcState = 'normal';
      // Compensatory pause: 160-180% of normal
      return Math.round(this.basePpi * (1.70 + noise));
    }

    // Random PVC occurrence: ~20% chance per normal beat
    if (this.pvcState === 'normal' && Math.random() < 0.20) {
      this.pvcState = 'pause'; // next beat will be compensatory
      // Premature beat: 40-50% of normal
      return Math.round(this.basePpi * (0.45 + noise));
    }

    // Normal beat
    return Math.round(this.basePpi * (1 + noise));
  }

  /**
   * Transition scenario: starts as NSR, switches to AF at beat 100.
   * Tests dance transition detection and logging.
   */
  private simulateTransition(): number {
    if (this.beatIndex < this.transitionBeat) {
      return this.simulateNSR();
    }
    return this.simulateAF();
  }
}

/**
 * Runs a full simulation: generates PPIs, feeds through quality gate and torus pipeline,
 * returns the features and dance match at regular intervals.
 */
export function generateSimulatedPPIs(scenario: RhythmScenario, count: number): number[] {
  const sim = new RhythmSimulator({ scenario });
  const ppis: number[] = [];
  for (let i = 0; i < count; i++) {
    ppis.push(sim.next());
  }
  return ppis;
}
