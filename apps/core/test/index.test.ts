import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app, { createApp } from "../src/index";

describe("HomeMew Core API", () => {
  it("returns health without querying D1", async () => {
    const response = await app.request("/health", {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: "ok" } });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("retains an incoming request ID", async () => {
    const response = await app.request(
      "/health",
      { headers: { "x-request-id": "request-from-client" } },
      env,
    );

    expect(response.headers.get("x-request-id")).toBe("request-from-client");
  });

  it("reports API and D1 status", async () => {
    const response = await app.request("/api/v1/status", {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        status: "ok",
        database: "available",
        schemaVersion: "6",
      },
    });
  });

  it("returns the common error envelope for unknown routes", async () => {
    const response = await app.request(
      "/missing",
      { headers: { "x-request-id": "missing-route" } },
      env,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe("missing-route");
    expect(await response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: "missing-route",
      },
    });
  });

  it("hides internal errors while retaining their request ID", async () => {
    const failingApp = createApp({
      getSchemaVersion: async () => {
        throw new Error("database details must stay private");
      },
    });
    const response = await failingApp.request(
      "/api/v1/status",
      { headers: { "x-request-id": "failed-status" } },
      env,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("failed-status");
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId: "failed-status",
      },
    });
  });

  it("allows the default local web origin", async () => {
    const response = await app.request(
      "/health",
      { headers: { Origin: "http://localhost:5173" } },
      env,
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
  });
});
