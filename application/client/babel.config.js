module.exports = {
  presets: [
    ["@babel/preset-typescript"],
    [
      "@babel/preset-env",
      {
        targets: { chrome: "130" },
        modules: "commonjs",
        useBuiltIns: false,
      },
    ],
    [
      "@babel/preset-react",
      {
        development: true,
        runtime: "automatic",
      },
    ],
  ],
};
