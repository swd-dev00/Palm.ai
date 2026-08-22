import { z } from "zod";
import { publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" as const, service: "palm-control-plane" })),
  capabilities: publicProcedure.query(() => ({
    hostedRunner: "github_actions",
    localRunner: true,
    localBrowserRunner: true,
  })),
  version: publicProcedure.query(() => ({ version: process.env.npm_package_version ?? "0.1.0" })),
  echo: publicProcedure.input(z.object({ value: z.string().max(128) })).query(({ input }) => input),
});
