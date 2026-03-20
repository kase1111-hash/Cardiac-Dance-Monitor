export interface PulseSample {
  timestamp: number;     // Unix ms
  ppiMs: number;         // pulse-to-pulse interval in milliseconds
  source: 'ble_rr' | 'ble_hr' | 'ble_ppg' | 'camera_ppg';
  valid: boolean;
}

export interface TorusPoint {
  theta1: number;        // [0, 2π)
  theta2: number;        // [0, 2π)
  kappa: number;         // Menger curvature at this point
  beatIndex: number;
}

export interface DanceMatch {
  name: string;          // "The Waltz", "The Lock-Step", etc.
  confidence: number;    // 0-1
  runnerUp: string;
  runnerUpConfidence: number;
  kappaMedian: number;
  gini: number;
  spread: number;
  bpm: number;
}

export interface PersonalBaseline {
  kappaMean: number;
  kappaSd: number;
  giniMean: number;
  giniSd: number;
  spreadMean: number;
  spreadSd: number;
  bpmMean: number;
  recordedAt: number;    // Unix ms
  beatCount: number;
}

export interface ChangeStatus {
  mahalanobisDistance: number;
  level: 'learning' | 'normal' | 'notice' | 'alert';
  sustainedSince: number | null; // Unix ms when level first entered
}
