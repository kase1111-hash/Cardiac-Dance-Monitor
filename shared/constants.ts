// shared/constants.ts (also mirrored in firmware/src/constants.h)

// Quality gating
export const PPI_MIN = 300;          // ms (200 BPM max)
export const PPI_MAX = 1500;         // ms (40 BPM min)
export const PPI_DEVIATION_MAX = 0.4; // 40% from running median = artifact
export const QUALITY_GOOD = 0.9;     // >90% acceptance rate
export const QUALITY_FAIR = 0.7;     // 70-90%
export const MIN_VALID_PPI = 20;     // in 30-beat window before torus computation

// Torus computation
export const TORUS_WINDOW = 60;      // beats in rolling window
export const KAPPA_WINDOW = 60;      // beats for κ median/Gini computation
export const DANCE_UPDATE_INTERVAL = 10; // beats between dance re-identification

// Dance centroids — calibrated against the fixed-normalization pipeline.
// Derived from 10 trials × 200 beats per scenario through the actual
// toAngle(PPI_MIN, PPI_MAX) → mengerCurvature → gini/spread pipeline.
// Original Paper IV centroids used different normalization bounds.
export const DANCE_CENTROIDS = [
  { name: 'The Waltz',     clinical: 'NSR', kappa: 7.7,  gini: 0.338, spread: 0.33 },
  { name: 'The Lock-Step', clinical: 'CHF', kappa: 33.3, gini: 0.306, spread: 0.04 },
  { name: 'The Sway',      clinical: 'SVA', kappa: 4.0,  gini: 0.400, spread: 1.0  },
  { name: 'The Mosh Pit',  clinical: 'AF',  kappa: 0.7,  gini: 0.305, spread: 2.35 },
  { name: 'The Stumble',   clinical: 'VA',  kappa: 0.5,  gini: 0.720, spread: 3.30 },
] as const;

// Normalization scales for distance computation
export const KAPPA_SCALE = 25;       // normalizes κ range
export const GINI_SCALE = 0.3;      // normalizes Gini range
export const SPREAD_SCALE = 2.0;    // normalizes spread range

// Confidence
export const CONFIDENCE_UNCERTAIN = 0.30; // below this: display "Uncertain"
export const CONFIDENCE_LOW = 0.50;       // below this: dim the label

// Baseline / Change detection
export const BASELINE_DURATION = 300;     // seconds (5 minutes) for initial baseline
export const BASELINE_MIN_BEATS = 200;    // minimum beats before baseline is valid
export const CHANGE_NOTICE_SIGMA = 2;     // Mahalanobis distance for notice
export const CHANGE_ALERT_SIGMA = 3;      // Mahalanobis distance for alert
export const CHANGE_ALERT_SUSTAIN = 60;   // seconds sustained before alert fires

// Display
export const TORUS_DISPLAY_POINTS = 60;   // max points shown on torus
export const MINI_TORUS_SIZE = 32;        // pixels (Tier 2 OLED)
