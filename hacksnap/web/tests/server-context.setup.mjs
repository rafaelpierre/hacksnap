import { jest } from "@jest/globals";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const server = createRequire(import.meta.url)("next/server");
// Unit tests invoke route functions without Next's request AsyncLocalStorage.
// Production rendering and cache opt-outs are exercised by the browser build.
jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("next/server", () => ({ ...server, connection: async () => {} }));
