export interface QuotaContext {
  quotaKey: string;
  dailyLimit: number;
  usedTodayAtDispatch: number;
}

export type QuotaDecision = 
  | { allowed: true; reason: string; quotaContext?: QuotaContext }
  | { allowed: false; code: 'quota_blocked'; reason: string };

/**
 * Evaluates runner-provider quota decisions using UTC daily windows.
 */
export async function evaluateRunnerQuota(
  userId: string,
  provider: 'local' | 'github_actions',
  getUsageCount: (userId: string, provider: string, sinceUTC: Date) => Promise<number>
): Promise<QuotaDecision> {
  // 1. Treat Local Runner execution as zero-cost/unlimited
  if (provider === 'local') {
    return { 
      allowed: true, 
      reason: 'Local runner execution is zero-cost and unlimited.' 
    };
  }

  // 2. Evaluate GitHub Actions Hosted-Runner quota
  if (provider === 'github_actions') {
    const limitEnv = process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA;
    const dailyLimit = limitEnv ? parseInt(limitEnv, 10) : 0;

    // Default to 0 unless explicitly configured
    if (dailyLimit <= 0) {
      return { 
        allowed: false, 
        code: 'quota_blocked', 
        reason: 'GitHub Actions daily quota is unconfigured or set to 0. Cannot dispatch hosted runner.' 
      };
    }

    // Determine UTC daily quota window start
    const now = new Date();
    const startOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Get usage from the DB helper
    const usedTodayAtDispatch = await getUsageCount(userId, provider, startOfDayUTC);

    // Block if exhausted
    if (usedTodayAtDispatch >= dailyLimit) {
      return {
        allowed: false,
        code: 'quota_blocked',
        reason: `Exhausted daily quota: ${usedTodayAtDispatch}/${dailyLimit} hosted runs used today.`
      };
    }

    // Allow and store quota context
    return {
      allowed: true,
      reason: 'Quota available.',
      quotaContext: {
        quotaKey: 'github_actions_daily_utc',
        dailyLimit,
        usedTodayAtDispatch
      }
    };
  }

  return { allowed: false, code: 'quota_blocked', reason: `Unknown provider: ${provider}` };
}
