export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.mjs", "<rootDir>/tests/**/*.test.tsx"],
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: {
    "^next/image$": "<rootDir>/tests/next-image-mock.cjs",
    "\\.module\\.css$": "<rootDir>/tests/style-module-mock.cjs",
  },
  // jsdom and sbd require ESM dependencies; Jest on Node 22 needs them compiled to CJS.
  transformIgnorePatterns: [
    "/node_modules/(?!(@exodus/bytes|@asamuzakjp/[^/]+|@csstools/[^/]+|@bramus/specificity|css-tree|parse5|entities|htmlparser2|domhandler|domutils|domelementtype|dom-serializer)/)",
  ],
  transform: {
    "/node_modules/.+\\.m?js$": [
      "@swc/jest",
      {
        jsc: { parser: { syntax: "ecmascript" }, target: "es2022" },
        module: { type: "commonjs" },
      },
    ],
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
