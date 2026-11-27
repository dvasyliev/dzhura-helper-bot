import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

/** An msw server for a test file: unhandled requests fail, handlers added in a test are reset after it. */
export function mockServer() {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}
