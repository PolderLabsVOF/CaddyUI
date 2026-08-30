// Stub the native sqlite drivers — see probeTarget.test.js for the same
// reason.
vi.mock('sqlite3', () => ({ default: { Database: function () {} }, Database: function () {} }));
vi.mock('sqlite', () => ({ open: () => Promise.resolve({ exec: () => Promise.resolve(), run: () => Promise.resolve(), get: () => Promise.resolve(null), all: () => Promise.resolve([]), close: () => Promise.resolve() }) }));

import net from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { checkProxyHealth } from '../../../server/index.js';

let stubServer;
let stubPort;

describe('checkProxyHealth', () => {
  beforeAll(async () => {
    stubServer = net.createServer();
    await new Promise((resolve) => stubServer.listen(0, '127.0.0.1', resolve));
    stubPort = stubServer.address().port;
  });

  afterAll(async () => {
    if (stubServer) await new Promise((resolve) => stubServer.close(resolve));
  });

  test('checkProxyHealth_activeSiteOnlineAndDisabledSiteReportsError', async () => {
    // Arrange — one active site pointing at the local TCP stub and one disabled site
    const parsed = {
      sites: [
        {
          id: 'site-active',
          disabled: false,
          addresses: ['example.com'],
          proxies: [{ upstreams: [`127.0.0.1:${stubPort}`] }],
        },
        {
          id: 'site-disabled',
          disabled: true,
          addresses: ['example.com'],
          proxies: [{ upstreams: ['192.168.0.10:8080'] }],
        },
      ],
    };
    // Act
    const result = await checkProxyHealth(parsed);
    // Assert — active site probes online; disabled site short-circuits with the expected error
    expect(result['site-active'].local.online).toBe(true);
    expect(result['site-disabled'].local.error).toBe('disabled');
  });
});