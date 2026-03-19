/**
 * Session data types — per SPEC Section 7.
 */

export interface Session {
  id: string;
  startTime: number;
  endTime: number;
  dominantDance: string;
  beatCount: number;
  changeEvents: Array<{
    timestamp: number;
    level: 'notice' | 'alert';
    distance: number;
    danceBefore: string;
    danceAfter: string;
  }>;
  danceTransitions: Array<{
    timestamp: number;
    from: string;
    to: string;
  }>;
  summaryStats: {
    bpmMean: number;
    kappaMedian: number;
    giniMean: number;
  };
}
