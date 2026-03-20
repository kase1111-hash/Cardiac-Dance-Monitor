/**
 * Session export tests — CSV and PDF generation.
 *
 * Tests the data formatting logic. Actual file I/O and sharing
 * use expo-file-system and expo-sharing (not available in Jest).
 */
import { SessionExporter } from '../session/session-export';
import type { Session, RawBeat } from '../session/session-types';

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

describe('SessionExporter.toRawCSV', () => {
  const MOCK_RAW_BEATS: RawBeat[] = [
    {
      timestamp_ms: 1700000001000,
      ppi_ms: 857,
      source: 'ble_ppg',
      raw_ppg: 142,
      spo2: 98,
      device_bpm: 70,
      kappa: 7.7,
      gini: 0.338,
      spread: 0.33,
      dance: 'The Waltz',
      confidence: 0.92,
      baseline_distance: 1.2,
      trail_length: 18,
    },
    {
      timestamp_ms: 1700000001857,
      ppi_ms: 843,
      source: 'ble_ppg',
      raw_ppg: 155,
      spo2: 97,
      device_bpm: 71,
      kappa: 7.7,
      gini: 0.338,
      spread: 0.33,
      dance: 'The Waltz',
      confidence: 0.92,
      baseline_distance: null,
      trail_length: 18,
    },
    {
      timestamp_ms: 1700000002700,
      ppi_ms: 800,
      source: 'simulated',
      raw_ppg: null,
      spo2: null,
      device_bpm: null,
      kappa: 0,
      gini: 0,
      spread: 0,
      dance: 'Unknown',
      confidence: 0,
      baseline_distance: null,
      trail_length: 20,
    },
  ];

  const SESSION_WITH_RAW: Session = {
    ...MOCK_SESSION,
    rawBeats: MOCK_RAW_BEATS,
  };

  test('generates correct CSV header', () => {
    const csv = SessionExporter.toRawCSV(SESSION_WITH_RAW);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'timestamp_ms,ppi_ms,source,raw_ppg,spo2,device_bpm,kappa,gini,spread,dance,confidence,baseline_distance,trail_length',
    );
  });

  test('has one row per beat plus header', () => {
    const csv = SessionExporter.toRawCSV(SESSION_WITH_RAW);
    const lines = csv.split('\n');
    expect(lines.length).toBe(4); // header + 3 beats
  });

  test('first data row contains correct values', () => {
    const csv = SessionExporter.toRawCSV(SESSION_WITH_RAW);
    const lines = csv.split('\n');
    const fields = lines[1].split(',');
    expect(fields[0]).toBe('1700000001000');  // timestamp_ms
    expect(fields[1]).toBe('857');             // ppi_ms
    expect(fields[2]).toBe('ble_ppg');         // source
    expect(fields[3]).toBe('142');             // raw_ppg
    expect(fields[4]).toBe('98');              // spo2
    expect(fields[5]).toBe('70');              // device_bpm
    expect(fields[6]).toBe('7.70');            // kappa
    expect(fields[7]).toBe('0.3380');          // gini
    expect(fields[8]).toBe('0.330');           // spread
    expect(fields[9]).toBe('The Waltz');       // dance
    expect(fields[10]).toBe('92.0');           // confidence
    expect(fields[11]).toBe('1.2');            // baseline_distance
    expect(fields[12]).toBe('18');             // trail_length
  });

  test('null values render as empty strings', () => {
    const csv = SessionExporter.toRawCSV(SESSION_WITH_RAW);
    const lines = csv.split('\n');
    const fields = lines[3].split(','); // third beat (simulated, all nulls)
    expect(fields[3]).toBe('');  // raw_ppg null
    expect(fields[4]).toBe('');  // spo2 null
    expect(fields[5]).toBe('');  // device_bpm null
    expect(fields[11]).toBe(''); // baseline_distance null
  });

  test('handles session with no rawBeats', () => {
    const csv = SessionExporter.toRawCSV(MOCK_SESSION);
    const lines = csv.split('\n');
    expect(lines.length).toBe(1); // header only
  });

  test('getRawFilename generates correct name', () => {
    const name = SessionExporter.getRawFilename(MOCK_SESSION);
    expect(name).toMatch(/^cardiac-dance-raw-.*\.csv$/);
    expect(name).toContain('test-session-1');
  });
});
