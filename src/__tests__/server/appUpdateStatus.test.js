// Vitest hoists vi.mock calls to the top of the module, before any import.
// We stub the native sqlite drivers because server/index.js loads
// stateStore.js (which loads sqlite3) on import — same reason as the other
// server tests.
vi.mock('sqlite3', () => ({ default: { Database: function () {} }, Database: function () {} }));
vi.mock('sqlite', () => ({ open: () => Promise.resolve({ exec: () => Promise.resolve(), run: () => Promise.resolve(), get: () => Promise.resolve(null), all: () => Promise.resolve([]), close: () => Promise.resolve() }) }));

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { appUpdateStatus, setRunForTests } from '../../../server/index.js';

// appUpdateStatus shells out to git many times via the internal `run` helper.
// To stay hermetic without mocking `node:child_process` (which does not
// reliably propagate across vitest's ESM module-boundary into
// server/index.js's destructured `spawn`), the function exposes
// `setRunForTests` for the test suite. We queue canned responses per test.
let queue = [];
let runCalls = [];

const fakeRun = (command, args) => {
  runCalls.push({ command, args });
  const response = queue.shift() || { stdout: '', stderr: '', ok: false };
  return Promise.resolve({
    ok: response.ok,
    code: response.ok ? 0 : 1,
    stdout: response.stdout,
    stderr: response.stderr,
  });
};

beforeEach(() => {
  queue = [];
  runCalls = [];
  setRunForTests(fakeRun);
});

afterEach(() => {
  setRunForTests(null);
});

// Helper: queue up the exact sequence of git responses appUpdateStatus will
// request when called with fetchMode=false. The order is:
//   1. `git rev-parse --abbrev-ref HEAD`            (via appBranch)
//   2. `git rev-parse HEAD`                          (localCommit)
//   3. `git rev-parse origin/<branch>`              (remoteCommit)
//   4. `git show HEAD:package.json`                 (localVersion)
//   5. `git show origin/<branch>:package.json`      (remoteVersion)
//   6. `git tag --list v* --sort=-v:refname`        (tagAhead)
// Pass `channelOverride='beta'` to land on the beta branch.
function queueGitResponses({ localCommit, remoteCommit, localVersion, remoteVersion, tagOutput, currentBranch = 'beta' }) {
  queue.push(
    { stdout: currentBranch, ok: true },                              // 1. rev-parse --abbrev-ref HEAD
    { stdout: localCommit, ok: Boolean(localCommit) },               // 2. rev-parse HEAD
    { stdout: remoteCommit, ok: Boolean(remoteCommit) },             // 3. rev-parse origin/<branch>
    { stdout: JSON.stringify({ version: localVersion }), ok: Boolean(localVersion) }, // 4. show HEAD:package.json
    { stdout: JSON.stringify({ version: remoteVersion }), ok: Boolean(remoteVersion) }, // 5. show origin/<branch>:package.json
    { stdout: tagOutput, ok: Boolean(tagOutput) },                   // 6. tag --list
  );
}

describe('appUpdateStatus — tag-only bump detection', () => {
  test('sameSha_higherTagAvailable_surfacesUpdate', async () => {
    // Arrange — local and remote on the same SHA, package.json version
    // unchanged, but `git tag --list` returns a higher tag (v0.2.11-beta)
    // pointing at HEAD. This is the regression from v0.2.11-beta: the
    // existing content-only comparison returns no update.
    const sameSha = 'bff429cdeadbeef00000000000000000000000000';
    queueGitResponses({
      localCommit: sameSha,
      remoteCommit: sameSha,
      localVersion: '0.2.10-beta',
      remoteVersion: '0.2.10-beta',
      tagOutput: 'v0.2.11-beta\nv0.2.10-beta\nv0.2.9-beta\n',
    });

    // Act — channelOverride='beta' so we target the beta branch.
    const result = await appUpdateStatus(false, 'beta');

    // Assert — update is available and availableVersion reflects the tag,
    // not the (unchanged) remote package.json.
    expect(result.updateAvailable).toBe(true);
    expect(result.availableVersion).toBe('0.2.11-beta');
    expect(result.localCommit).toBe(sameSha);
    expect(result.remoteCommit).toBe(sameSha);
  });

  test('sameSha_noTagAhead_returnsNoUpdate', async () => {
    // Arrange — same SHA, same package.json version, tag list contains only
    // the tag that already matches the local version.
    const sameSha = 'bff429cdeadbeef00000000000000000000000000';
    queueGitResponses({
      localCommit: sameSha,
      remoteCommit: sameSha,
      localVersion: '0.2.10-beta',
      remoteVersion: '0.2.10-beta',
      tagOutput: 'v0.2.10-beta\nv0.2.9-beta\n',
    });

    // Act
    const result = await appUpdateStatus(false, 'beta');

    // Assert — no update signal from any of the three paths.
    expect(result.updateAvailable).toBe(false);
    expect(result.availableVersion).toBe('0.2.10-beta');
  });

  test('remoteAhead_newCommits_surfacesUpdate', async () => {
    // Arrange — origin/<branch> has moved to a new SHA (real new commits).
    // Tag list is unchanged from the local side. This is the original
    // commit-distance path and must still fire.
    queueGitResponses({
      localCommit: 'aaaaaaa1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      remoteCommit: 'bbbbbbb2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      localVersion: '0.2.10-beta',
      remoteVersion: '0.2.10-beta',
      tagOutput: 'v0.2.10-beta\n',
    });

    // Act
    const result = await appUpdateStatus(false, 'beta');

    // Assert — the commit-distance path lights up.
    expect(result.updateAvailable).toBe(true);
    expect(result.availableVersion).toBe('0.2.10-beta');
    expect(result.localCommit).not.toBe(result.remoteCommit);
  });

  test('historyRewrite_packageJsonBumped_tagListNotAhead_surfacesUpdate', async () => {
    // Arrange — origin/<branch> rewrites history so HEAD == origin/<branch>
    // but the remote package.json version differs (e.g. force-pushed tag
    // with bumped version). The tag list has not been refreshed yet, so
    // the tag-ahead path does not fire — the versionChanged path must.
    const sameSha = 'ccccccc3cccccccccccccccccccccccccccccccccccc';
    queueGitResponses({
      localCommit: sameSha,
      remoteCommit: sameSha,
      localVersion: '0.2.10-beta',
      remoteVersion: '0.2.11-beta',
      tagOutput: 'v0.2.10-beta\n',
    });

    // Act
    const result = await appUpdateStatus(false, 'beta');

    // Assert — versionChanged path lights up; availableVersion comes from
    // the remote package.json (not the tag, because tagAhead is false).
    expect(result.updateAvailable).toBe(true);
    expect(result.availableVersion).toBe('0.2.11-beta');
  });
});