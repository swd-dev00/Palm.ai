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
  });
});
