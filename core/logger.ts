/* global console -- Allow console for leveled logging in browser environment (ESLint browser globals) */
// esbuild replaces `process.env.NODE_ENV` with a string literal at build time.
declare const process: { env: { NODE_ENV?: string } };

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// Quiet by default in production (warnings and errors only); verbose in dev builds.
// The per-scan/per-save info logs are useful when debugging but are noise otherwise.
const isProduction = process.env.NODE_ENV === "production";
let threshold = LEVEL_ORDER[isProduction ? "warn" : "debug"];

/** Adjust the minimum log level at runtime (e.g. to opt into verbose logging). */
export function setLogLevel(level: LogLevel): void {
  threshold = LEVEL_ORDER[level];
}

function formatDetails(details?: Record<string, unknown>): string {
  if (!details) return "";
  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return " [unserializable-details]";
  }
}

function write(level: LogLevel, scope: string, message: string, details?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < threshold) return;
  const prefix = `[Simplicial:${scope}] ${message}${formatDetails(details)}`;
  if (level === "error") {
    console.error(prefix);
    return;
  }
  if (level === "warn") {
    console.warn(prefix);
    return;
  }
  console.debug(prefix);
}

export const logger = {
  debug(scope: string, message: string, details?: Record<string, unknown>): void {
    write("debug", scope, message, details);
  },
  info(scope: string, message: string, details?: Record<string, unknown>): void {
    write("info", scope, message, details);
  },
  warn(scope: string, message: string, details?: Record<string, unknown>): void {
    write("warn", scope, message, details);
  },
  error(scope: string, message: string, details?: Record<string, unknown>): void {
    write("error", scope, message, details);
  },
};
