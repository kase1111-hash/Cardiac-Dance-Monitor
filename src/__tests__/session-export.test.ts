/**
 * Session export tests — CSV and PDF generation.
 *
 * Tests the data formatting logic. Actual file I/O and sharing
 * use expo-file-system and expo-sharing (not available in Jest).
 */
import { SessionExporter } from '../session/session-export';
import type { Session } from '../session/session-types';

const MOCK_SESSION: Session = {
  id: 'test-session-1',
  startTime: 1700000000000, // Nov 14, 2023
  endTime: 1700000300000,   // 5 minutes later
  dominantDance: 'The Waltz',
  beatCount: 350,
  changeEvents: [
    {
      timestamp: 1700000120000,
      level: 'notice',
      distance: 2.5,
      danceBefore: 'The Waltz',
      danceAfter: 'The Sway',
    },
  ],
  danceTransitions: [
    { timestamp: 1700000100000, from: 'The Waltz', to: 'The Sway' },
    { timestamp: 1700000200000, from: 'The Sway', to: 'The Waltz' },
  ],
  summaryStats: {
    bpmMean: 72,
    kappaMedian: 10.5,
    giniMean: 0.39,
  },
};

describe('SessionExporter', () => {
  test('generates CSV with correct headers', () => {
    const csv = SessionExporter.toCSV(MOCK_SESSION);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Session ID');
    expect(lines[0]).toContain('Start Time');
    expect(lines[0]).toContain('Dominant Dance');
    expect(lines[0]).toContain('Beat Count');
    expect(lines[0]).toContain('BPM Mean');
  });

  test('CSV contains session data', () => {
    const csv = SessionExporter.toCSV(MOCK_SESSION);
    expect(csv).toContain('test-session-1');
    expect(csv).toContain('The Waltz');
    expect(csv).toContain('350');
    expect(csv).toContain('72');
  });

  test('CSV includes change events section', () => {
    const csv = SessionExporter.toCSV(MOCK_SESSION);
    expect(csv).toContain('Change Events');
    expect(csv).toContain('notice');
    expect(csv).toContain('2.5');
  });

  test('CSV includes dance transitions section', () => {
    const csv = SessionExporter.toCSV(MOCK_SESSION);
    expect(csv).toContain('Dance Transitions');
    expect(csv).toContain('The Waltz');
    expect(csv).toContain('The Sway');
  });

  test('generates HTML for PDF with session summary', () => {
    const html = SessionExporter.toHTML(MOCK_SESSION);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('test-session-1');
    expect(html).toContain('The Waltz');
    expect(html).toContain('350');
    expect(html).toContain('72');
    expect(html).toContain('RESEARCH PROTOTYPE');
  });

  test('HTML includes change events', () => {
    const html = SessionExporter.toHTML(MOCK_SESSION);
    expect(html).toContain('notice');
    expect(html).toContain('The Sway');
  });

  test('HTML includes dance transitions', () => {
    const html = SessionExporter.toHTML(MOCK_SESSION);
    expect(html).toContain('Dance Transitions');
  });

  test('generates valid filename', () => {
    const name = SessionExporter.getFilename(MOCK_SESSION, 'csv');
    expect(name).toMatch(/^cardiac-dance-.*\.csv$/);
    expect(name).toContain('test-session-1');
  });

  test('handles session with no change events', () => {
    const session: Session = {
      ...MOCK_SESSION,
      changeEvents: [],
      danceTransitions: [],
    };
    const csv = SessionExporter.toCSV(session);
    expect(csv).toContain('No change events');

    const html = SessionExporter.toHTML(session);
    expect(html).toContain('No change events');
  });
});
