import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../schema";
import { getUserByOpenId } from "../../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

/**
 * The original export omitted its OAuth SDK adapter. This context intentionally
 * refuses to manufacture an authenticated production user. A local developer
 * may set PALM_DEV_OPEN_ID in non-production after seeding a matching user.
 * Replace this branch with the real OAuth/session resolver before production.
 */
export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  const devOpenId = process.env.NODE_ENV !== "production" ? process.env.PALM_DEV_OPEN_ID : undefined;
  if (devOpenId) user = (await getUserByOpenId(devOpenId)) ?? null;
  return { req: opts.req, res: opts.res, user };
}
