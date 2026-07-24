import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { failure, success } from "./http";
import { registerBusinessRoutes } from "./business";
import { registerEventRoutes } from "./events";
import { registerTaskRoutes } from "./tasks";
import { registerIntegrationRoutes } from "./integrations";

type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

type Dependencies = {
  getSchemaVersion: (env: Bindings) => Promise<string>;
};

const defaultOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

async function getSchemaVersion(env: Bindings): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT value FROM schema_metadata WHERE key = ?",
  )
    .bind("schema_version")
    .first<{ value: string }>();

  if (!row) {
    throw new Error("schema version metadata is missing");
  }

  return row.value;
}

function configuredOrigins(env: Bindings): string[] {
  if (!env.CORS_ORIGINS) {
    return defaultOrigins;
  }

  return env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createApp(
  overrides: Partial<Dependencies> = {},
): Hono<AppEnv> {
  const dependencies: Dependencies = {
    getSchemaVersion,
    ...overrides,
  };
  const app = new Hono<AppEnv>();

  app.use("*", async (context, next) => {
    const incomingRequestId = context.req.header("x-request-id")?.trim();
    const requestId = incomingRequestId || crypto.randomUUID();

    context.set("requestId", requestId);
    await next();
    context.header("x-request-id", requestId);
  });

  app.use(
    "*",
    cors({
      origin: (origin, context) => {
        return configuredOrigins(context.env).includes(origin)
          ? origin
          : undefined;
      },
    }),
  );

  app.get("/health", (context) => {
    return context.json(success({ status: "ok" }));
  });

  app.get("/api/v1/status", async (context) => {
    const schemaVersion = await dependencies.getSchemaVersion(context.env);

    return context.json(
      success({
        status: "ok",
        database: "available",
        schemaVersion,
      }),
    );
  });

  registerBusinessRoutes(app);
  registerIntegrationRoutes(app);
  registerEventRoutes(app);
  registerTaskRoutes(app);

  app.notFound((context) => {
    return context.json(
      failure(
        "NOT_FOUND",
        "Route not found",
        context.get("requestId"),
      ),
      404,
    );
  });

  app.onError((error, context) => {
    const requestId = context.get("requestId");

    if (error instanceof ApiError) {
      return context.json(failure(error.code, error.message, requestId), error.status);
    }

    console.error("Unhandled Core API error", {
      requestId,
      error,
    });

    return context.json(
      failure(
        "INTERNAL_ERROR",
        "Internal server error",
        requestId,
      ),
      500,
    );
  });

  return app;
}
