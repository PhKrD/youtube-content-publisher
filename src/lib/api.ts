import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, Errors, toAppError } from "./errors";
import { logger } from "./logger";

/**
 * Route-handler plumbing.
 *
 * Centralised so that no individual route can accidentally leak a stack trace
 * or a raw Postgres error to the browser (Section 50). Handlers throw
 * AppErrors; this converts them into a stable JSON shape and logs the
 * technical detail server-side only.
 */

export type ApiHandler<T = unknown> = (request: Request, context: T) => Promise<Response>;

/** Wraps a handler with uniform error handling. */
export function route<T = unknown>(handler: ApiHandler<T>): ApiHandler<T> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (err) {
      const appError = toAppError(err);

      // 5xx means we did something wrong; log loudly with the detail.
      if (appError.status >= 500) {
        logger.error("unhandled route error", {
          code: appError.code,
          detail: appError.detail,
          path: new URL(request.url).pathname,
          method: request.method,
          error: err,
        });
      } else {
        logger.debug("route error", {
          code: appError.code,
          detail: appError.detail,
          path: new URL(request.url).pathname,
        });
      }

      return NextResponse.json(appError.toResponseBody(), {
        status: appError.status,
        ...(appError.retryAfterSeconds
          ? { headers: { "Retry-After": String(appError.retryAfterSeconds) } }
          : {}),
      });
    }
  };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 }) as NextResponse;
}

/**
 * Parses and validates a JSON body.
 *
 * Rejects oversized bodies before parsing: a 50 MB JSON payload would
 * otherwise be fully buffered in memory before validation could reject it.
 */
export async function parseJson<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes = 512 * 1024,
): Promise<z.infer<S>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw Errors.payloadTooLarge("That request was too large.");
  }

  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > maxBytes) {
      throw Errors.payloadTooLarge("That request was too large.");
    }
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw Errors.validation("The request body was not valid JSON.");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw Errors.validation(
      humaniseZodIssue(first),
      first?.path.join(".") || undefined,
      JSON.stringify(parsed.error.issues.slice(0, 5)),
    );
  }
  return parsed.data;
}

/** Validates query-string parameters. */
export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.infer<S> {
  const url = new URL(request.url);
  const obj: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    obj[key] = all.length > 1 ? all : all[0];
  }
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw Errors.validation(humaniseZodIssue(first), first?.path.join(".") || undefined);
  }
  return parsed.data;
}

/**
 * Turns a Zod issue into something a student can act on.
 * Zod's own wording ("Invalid input: expected string, received undefined") is
 * accurate but useless in a UI.
 */
function humaniseZodIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return "Some of the information provided was not valid.";
  const field = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : "value";
  const pretty = field
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase();

  switch (issue.code) {
    case "invalid_type":
      return `Please provide a valid ${pretty}.`;
    case "too_small":
      return `${capitalise(pretty)} is too short.`;
    case "too_big":
      return `${capitalise(pretty)} is too long.`;
    case "invalid_format":
      return `Please provide a valid ${pretty}.`;
    case "invalid_value":
      return `${capitalise(pretty)} is not one of the allowed values.`;
    default:
      return issue.message || `Please check the ${pretty}.`;
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Common id-in-path schema. */
export const idParam = z.object({ id: z.string().min(1).max(64) });
