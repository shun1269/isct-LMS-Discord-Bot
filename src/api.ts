import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { getLastSync, syncAssignments } from "./repository.js";
import { syncPayloadSchema } from "./types.js";

function tokensEqual(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function authenticateSync(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const authorization = request.header("authorization") ?? "";
  const [scheme, token] = authorization.split(" ", 2);

  if (
    scheme !== "Bearer" ||
    !token ||
    !tokensEqual(token, config.syncToken)
  ) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}

export function createApi() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      now: new Date().toISOString(),
      lastSync: getLastSync(),
    });
  });

  app.post(
    "/api/v1/assignments/sync",
    authenticateSync,
    (request, response) => {
      const parsed = syncPayloadSchema.safeParse(request.body);

      if (!parsed.success) {
        response.status(400).json({
          error: "invalid_payload",
          details: parsed.error.issues,
        });
        return;
      }

      const result = syncAssignments(parsed.data);
      response.json({ ok: true, ...result });
    },
  );

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      console.error("Unhandled API error:", error);
      response.status(500).json({ error: "internal_server_error" });
    },
  );

  return app;
}
