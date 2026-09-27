export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.mjs", "<rootDir>/tests/**/*.test.tsx"],
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  transform: {
    "^.+\\.tsx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true },
          transform: { react: { runtime: "automatic" } },
          target: "es2022",
        },
        module: { type: "es6" },
      },
    ],
  },
};
