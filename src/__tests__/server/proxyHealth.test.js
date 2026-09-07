vi.mock('sqlite3', () => ({ default: { Database: function Database() {} }, Database: function Database() {} }));
vi.mock('sqlite', () => ({ open: () => Promise.resolve({ exec: async () => {}, run: async () => {}, get: async () => null, all: async () => [], close: async () => {} }) }));

import net from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { checkProxyHealth, probeTarget } from '../../../server/index.js';

let server;
let port;

describe('local proxy health', () => {
  beforeAll(async () => {
    server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test('allows loopback and private-network targets from the active Caddy config', async () => {
    const result = await probeTarget('127.0.0.1', port);
    expect(result).toMatchObject({ online: true, host: '127.0.0.1', port });
    expect(result.error).not.toBe('blocked-private-address');
  });

  test('reports active and disabled sites without probing public domains', async () => {
    const health = await checkProxyHealth({
      sites: [
        { id: 'active', disabled: false, addresses: ['example.invalid'], proxies: [{ upstreams: [`127.0.0.1:${port}`] }] },
        { id: 'disabled', disabled: true, addresses: ['disabled.invalid'], proxies: [{ upstreams: ['10.0.0.2:8080'] }] },
      ],
    });
    expect(health.active.local.online).toBe(true);
    expect(health.active).not.toHaveProperty('domain');
    expect(health.disabled.local).toMatchObject({ online: false, error: 'disabled' });
  });
});
