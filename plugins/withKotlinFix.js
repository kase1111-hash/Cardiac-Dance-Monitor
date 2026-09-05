/**
 * Expo config plugin: Kotlin version compatibility guard for Android builds.
 *
 * app.json pins Kotlin 1.9.25 via expo-build-properties, which SDK 52's
 * expo-modules-core maps to a matching Compose compiler. As a belt-and-braces
 * guard for any dependency that still compares Kotlin versions strictly, this
 * plugin writes `kotlin.suppressKotlinVersionCompatibilityCheck=true` to
 * gradle.properties so a minor mismatch never fails the EAS build.
 */
const { withGradleProperties } = require('@expo/config-plugins');

module.exports = function withKotlinFix(config) {
  return withGradleProperties(config, (cfg) => {
    const key = 'kotlin.suppressKotlinVersionCompatibilityCheck';
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === key),
    );
    cfg.modResults.push({ type: 'property', key, value: 'true' });
    return cfg;
  });
};
