import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createStateStore } from '../../../server/stateStore.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('AI conversations', () => {
  test('names only the untouched default conversation', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caddyui-ai-conversations-'));
    temporaryDirectories.push(dataDir);
    const store = await createStateStore({ dataDir });
    await store.createAiConversation({ id: 'conversation-1', username: 'alex', title: 'New conversation', createdAt: 1 });

    await expect(store.nameAiConversation('conversation-1', 'alex', 'Create an application proxy')).resolves.toBe(true);
    await expect(store.nameAiConversation('conversation-1', 'alex', 'A later message')).resolves.toBe(false);

    await expect(store.getAiConversation('conversation-1', 'alex')).resolves.toMatchObject({ title: 'Create an application proxy' });
  });
});
