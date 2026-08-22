import type { Request } from "express";

export const COOKIE_NAME = "palm_session";

function requestUsesHttps(req: Request) {
  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  return req.secure || forwardedProto === "https";
}

export function getSessionCookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" || requestUsesHttps(req),
    path: "/",
  };
}
