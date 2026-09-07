import { describe, expect, test } from 'vitest';
import { buildAssistantSystemPrompt } from '../../../server/aiAssistant.js';

describe('CaddyUI assistant skill', () => {
  test('is loaded for every request without exposing raw configuration', () => {
    const prompt = buildAssistantSystemPrompt({
      user: { role: 'edit' },
      context: {
        configContent: 'SECRET_RAW_CONFIG_MUST_NOT_REACH_PROVIDER',
        proxies: [{ line: 12, host: 'example.test', upstream: 'http://10.0.0.2:8080' }],
        status: { configMode: 'api', proxyCount: 1 },
      },
    });

    expect(prompt).toContain('<caddyui-assistant-skill version="1">');
    expect(prompt).toContain('Every mutation must be prepared through a `propose_*` tool');
    expect(prompt).toContain('Current user role: edit.');
    expect(prompt).toContain('example.test');
    expect(prompt).not.toContain('SECRET_RAW_CONFIG_MUST_NOT_REACH_PROVIDER');
  });

  test('falls back to view permissions for an unknown role', () => {
    const prompt = buildAssistantSystemPrompt({ user: { role: 'owner' }, context: {} });
    expect(prompt).toContain('Current user role: view.');
  });
});

