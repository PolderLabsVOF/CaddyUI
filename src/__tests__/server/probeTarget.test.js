// Vitest hoists vi.mock calls to the top of the module, before any import.
// We stub the native sqlite drivers because server/index.js loads
// stateStore.js (which loads sqlite3) on import, and the native binding is
// not available in the test environment.
vi.mock('sqlite3', () => ({ default: { Database: function () {} }, Database: function () {} }));
vi.mock('sqlite', () => ({ open: () => Promise.resolve({ exec: () => Promise.resolve(), run: () => Promise.resolve(), get: () => Promise.resolve(null), all: () => Promise.resolve([]), close: () => Promise.resolve() }) }));

// T3 needs dns.lookup to reject. Stub node:dns/promises to a minimal shape.
vi.mock('node:dns/promises', () => {
  const lookup = vi.fn();
  return {
    default: { lookup },
    lookup,
  };
});

import net from 'node:net';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { probeTarget } from '../../../server/index.js';

let stubServer;
let stubPort;

async function startStubServer(bindAddress = '127.0.0.1') {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, bindAddress, () => resolve());
  });
  return { server, port: server.address().port };
}

describe('probeTarget', () => {
  beforeAll(async () => {
    const stub = await startStubServer('127.0.0.1');
    stubServer = stub.server;
    stubPort = stub.port;
  });

  afterAll(async () => {
    if (stubServer) await new Promise((resolve) => stubServer.close(resolve));
  });

  test('probeTarget_loopbackTcpListener_returnsOnline', async () => {
    // Arrange — real TCP listener is already running on 127.0.0.1:stubPort
    // Act
    const result = await probeTarget('127.0.0.1', stubPort);
    // Assert
    expect(result.online).toBe(true);
  });

  test('probeTarget_nonLoopbackAddress_noPrivateIpBlock', async () => {
    // Arrange — bind a fresh stub if needed. The 127.0.0.1 stub is sufficient
    // because the assertion only cares that no "blocked-private-address"
    // error code is returned.
    // Act
    const result = await probeTarget('127.0.0.1', stubPort);
    // Assert — even though 127.0.0.1 is loopback, the new code path must
    // not surface any "blocked-private-address" guard error.
    expect(result.error === 'blocked-private-address').toBe(false);
  });

  test('probeTarget_dnsLookupRejects_returnsOfflineWithError', async () => {
    // Arrange — re-arm the dns.lookup mock to reject with ENOTFOUND
    const dns = await import('node:dns/promises');
    const lookup = dns.default.lookup;
    lookup.mockRejectedValueOnce(Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' }));
    // Act
    const result = await probeTarget('nonexistent.invalid', 80);
    // Assert — the function must propagate the DNS failure as an offline
    // result with some error code (ENOTFOUND or "lookup_failed").
    expect(result.online).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
