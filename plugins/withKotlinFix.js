/**
 * Config plugin to suppress Kotlin version compatibility check.
 *
 * EAS Build may use Kotlin 1.9.25 while the Compose Compiler bundled
 * with SDK 52 expects 1.9.24. This plugin writes the suppress flag
 * to android/gradle.properties during prebuild.
 *
 * Belt-and-suspenders approach: expo-build-properties pins kotlinVersion
 * to 1.9.24, and this plugin suppresses the check as a fallback in case
 * the build server overrides the Kotlin version.
 */
const { withGradleProperties } = require('expo/config-plugins');

function withKotlinFix(config) {
  return withGradleProperties(config, (config) => {
    // Remove any existing entries to avoid duplicates
    config.modResults = config.modResults.filter(
      (item) => item.key !== 'kotlin.suppressKotlinVersionCompatibilityCheck'
    );

    // Add the suppress flag
    config.modResults.push({
      type: 'property',
      key: 'kotlin.suppressKotlinVersionCompatibilityCheck',
      value: 'true',
    });

    return config;
  });
}

module.exports = withKotlinFix;
