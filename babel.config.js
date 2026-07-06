module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Required by react-native-vision-camera frame processors: compiles
    // functions marked 'worklet' to run on the camera thread. Without it,
    // useFrameProcessor throws at runtime.
    plugins: ['react-native-worklets-core/plugin'],
  };
};
