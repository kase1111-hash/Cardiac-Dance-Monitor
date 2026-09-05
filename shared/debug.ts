/**
 * Development-only logging.
 *
 * React Native keeps console.* calls in release builds — every call formats
 * a string and crosses into native to write a logcat/os_log line. Hot paths
 * (28 Hz BLE samples, per-beat pipeline traces, per-render torus logs) were
 * emitting tens of thousands of lines over a demo. Route diagnostics through
 * debugLog so they vanish in release without touching the call sites.
 *
 * `__DEV__` is defined by Metro; under Jest/Node it is absent and NODE_ENV
 * decides instead.
 */
declare const __DEV__: boolean | undefined;

export const IS_DEV: boolean =
  typeof __DEV__ === 'boolean' ? __DEV__ : process.env.NODE_ENV !== 'production';

export const debugLog: (...args: unknown[]) => void = IS_DEV
  ? (...args: unknown[]) => console.log(...args)
  : () => {};
