import { describe, it, expect, vi } from 'vitest';
import { evaluateRunnerQuota } from './costQuota';

describe('10.4 Cost/Quota Gate Module', () => {
  it('treats Local Runner execution as zero-cost/unlimited', async () => {
    const mockDbCount = vi.fn();
    const result = await evaluateRunnerQuota('user-123', 'local', mockDbCount);
    
    expect(result.allowed).toBe(true);
    expect(mockDbCount).not.toHaveBeenCalled();
  });

  it('blocks GitHub Actions if PALM_GITHUB_ACTIONS_DAILY_QUOTA is 0 or unconfigured', async () => {
    process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA = '0';
    const mockDbCount = vi.fn();
    const result = await evaluateRunnerQuota('user-123', 'github_actions', mockDbCount);
    
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe('quota_blocked');
    }
  });

  it('blocks GitHub Actions if usage meets or exceeds the UTC daily limit', async () => {
    process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA = '5';
    // Mock DB returning 5 (quota exhausted)
    const mockDbCount = vi.fn().mockResolvedValue(5); 
    const result = await evaluateRunnerQuota('user-123', 'github_actions', mockDbCount);
    
    expect(result.allowed).toBe(false);
  });

  it('allows GitHub Actions and returns quotaContext if under limit', async () => {
    process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA = '5';
    // Mock DB returning 2 (quota available)
    const mockDbCount = vi.fn().mockResolvedValue(2); 
    const result = await evaluateRunnerQuota('user-123', 'github_actions', mockDbCount);
    
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.quotaContext?.dailyLimit).toBe(5);
      expect(result.quotaContext?.usedTodayAtDispatch).toBe(2);
    }
  });
});
