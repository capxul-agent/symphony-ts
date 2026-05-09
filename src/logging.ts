import { Effect } from "effect";
import winston from "winston";

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: "symphony" },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "symphony.log" }),
  ],
});

export const logInfo = (message: string, meta?: Record<string, unknown>): Effect.Effect<void> =>
  Effect.sync(() => logger.info(message, meta));

export const logError = (message: string, meta?: Record<string, unknown>): Effect.Effect<void> =>
  Effect.sync(() => logger.error(message, meta));
