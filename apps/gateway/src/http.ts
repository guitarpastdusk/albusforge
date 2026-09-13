import type { ApiError } from "@albusforge/schema";
import type { FastifyReply } from "fastify";
import type { z } from "zod";

/** A failure the client caused or should know about, sent as the API error shape. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    /** Extra response headers, such as Retry-After. */
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function sendError(reply: FastifyReply, status: number, code: string, message: string, details?: unknown) {
  const body: ApiError = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  return reply.code(status).type("application/json; charset=utf-8").send(body);
}

export function parse<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    throw new HttpError(400, "BAD_REQUEST", `Invalid ${what}`, details);
  }
  return result.data;
}

/** The path without its query string, so logs never carry query values. */
export const pathOf = (url: string) => url.split("?", 1)[0] ?? url;
