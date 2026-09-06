import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";

/** A random cookie identifies a browser; only a salted hash of it is ever stored. */
export const VISITOR_COOKIE = "dz_v";

export function newVisitorId(): string {
  return randomBytes(16).toString("hex");
}

export function hashVisitor(id: string): string {
  return createHash("sha256").update(`${config().VISITOR_SALT}:${id}`).digest("hex").slice(0, 24);
}

export function isVisitorId(v: string | undefined | null): v is string {
  return typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
}
