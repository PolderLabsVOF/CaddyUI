import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function createStateStore({ dataDir, dbPath, settingsPath, sessionPath, fileMode = 0o600 }) {
  await fs.mkdir(dataDir, { recursive: true });
  const databasePath = dbPath || path.join(dataDir, 'caddyui.db');
  const db = await open({ filename: databasePath, driver: sqlite3.Database });
  await db.exec('PRAGMA journal_mode = WAL;');
  await db.exec('PRAGMA synchronous = NORMAL;');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS parse_cache (
      content_hash TEXT PRIMARY KEY,
      parsed_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS proxy_meta (
      proxy_key TEXT PRIMARY KEY,
      tags_json TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS event_log (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      actor_username TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      kind TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_log_kind ON event_log(kind, created_at DESC);
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(username, updated_at DESC);
    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id, created_at ASC);
    CREATE TABLE IF NOT EXISTS ai_pending_actions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      username TEXT NOT NULL,
      action_type TEXT NOT NULL,
      args_json TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      confirmed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_user ON ai_pending_actions(username, created_at DESC);
  `);
  try {
    await db.exec(`ALTER TABLE proxy_meta ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
  } catch {}

  if (settingsPath && fssync.existsSync(settingsPath)) {
    const existing = await db.get('SELECT key FROM kv_store WHERE key = ?', 'settings');
    if (!existing) {
      const settings = await readJsonFile(settingsPath);
      if (settings) {
        const now = Date.now();
        await db.run(
          'INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)',
          'settings',
          JSON.stringify(settings),
          now
        );
      }
    }
  }

  if (sessionPath && fssync.existsSync(sessionPath)) {
    const existing = await db.get('SELECT key FROM kv_store WHERE key = ?', 'sessions');
    if (!existing) {
      const sessions = await readJsonFile(sessionPath);
      if (sessions) {
        const now = Date.now();
        await db.run(
          'INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)',
          'sessions',
          JSON.stringify(sessions),
          now
        );
      }
    }
  }

  try {
    await fs.chmod(databasePath, fileMode);
  } catch {}

  return {
    async getJson(key, fallbackValue) {
      const row = await db.get('SELECT value FROM kv_store WHERE key = ?', key);
      if (!row?.value) return fallbackValue;
      try {
        return JSON.parse(row.value);
      } catch {
        return fallbackValue;
      }
    },

    async setJson(key, value) {
      const now = Date.now();
      const payload = JSON.stringify(value);
      await db.run(
        `
          INSERT INTO kv_store (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE
          SET value = excluded.value,
              updated_at = excluded.updated_at
        `,
        key,
        payload,
        now
      );
    },

    async getParsed(contentHash) {
      const row = await db.get('SELECT parsed_json FROM parse_cache WHERE content_hash = ?', contentHash);
      if (!row?.parsed_json) return null;
      try {
        return JSON.parse(row.parsed_json);
      } catch {
        return null;
      }
    },

    async setParsed(contentHash, parsed) {
      const now = Date.now();
      await db.run(
        `
          INSERT INTO parse_cache (content_hash, parsed_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(content_hash) DO UPDATE
          SET parsed_json = excluded.parsed_json,
              updated_at = excluded.updated_at
        `,
        contentHash,
        JSON.stringify(parsed),
        now
      );
    },

    async pruneParsed(limit = 300) {
      await db.run(
        `
          DELETE FROM parse_cache
          WHERE content_hash IN (
            SELECT content_hash
            FROM parse_cache
            ORDER BY updated_at DESC
            LIMIT -1 OFFSET ?
          )
        `,
        Math.max(50, Number(limit) || 300)
      );
    },

    async getProxyMetaMap() {
      const rows = await db.all('SELECT proxy_key, tags_json, category, description FROM proxy_meta');
      const result = {};
      for (const row of rows || []) {
        let tags = [];
        try {
          const parsed = JSON.parse(String(row.tags_json || '[]'));
          if (Array.isArray(parsed)) tags = parsed.map((x) => String(x || '').trim()).filter(Boolean);
        } catch {}
        result[row.proxy_key] = {
          tags,
          category: String(row.category || '').trim(),
          description: String(row.description || '').trim(),
        };
      }
      return result;
    },

    async setProxyMeta(proxyKey, tags = [], category = '', description = '') {
      const key = String(proxyKey || '').trim();
      if (!key) return;
      const cleanedTags = [...new Set((Array.isArray(tags) ? tags : []).map((x) => String(x || '').trim()).filter(Boolean))];
      const cleanedCategory = String(category || '').trim();
      const cleanedDescription = String(description || '').trim();
      const now = Date.now();
      await db.run(
        `
          INSERT INTO proxy_meta (proxy_key, tags_json, category, description, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(proxy_key) DO UPDATE
          SET tags_json = excluded.tags_json,
              category = excluded.category,
              description = excluded.description,
              updated_at = excluded.updated_at
        `,
        key,
        JSON.stringify(cleanedTags),
        cleanedCategory,
        cleanedDescription,
        now
      );
    },

    async deleteProxyMeta(proxyKey) {
      const key = String(proxyKey || '').trim();
      if (!key) return;
      await db.run('DELETE FROM proxy_meta WHERE proxy_key = ?', key);
    },

    async pruneProxyMeta(validKeys = []) {
      const keys = [...new Set((Array.isArray(validKeys) ? validKeys : []).map((x) => String(x || '').trim()).filter(Boolean))];
      if (keys.length === 0) {
        await db.run('DELETE FROM proxy_meta');
        return;
      }
      const placeholders = keys.map(() => '?').join(', ');
      await db.run(`DELETE FROM proxy_meta WHERE proxy_key NOT IN (${placeholders})`, ...keys);
    },

    async appendEvent(event = {}) {
      const payload = {
        id: String(event.id || '').trim(),
        createdAt: Number(event.createdAt || Date.now()),
        actorUsername: String(event.actorUsername || '').trim(),
        actorRole: String(event.actorRole || '').trim(),
        kind: String(event.kind || '').trim(),
        action: String(event.action || '').trim(),
        targetType: String(event.targetType || '').trim(),
        targetId: String(event.targetId || '').trim(),
        status: String(event.status || '').trim(),
        message: String(event.message || '').trim(),
        details: event.details && typeof event.details === 'object' ? event.details : {},
      };
      await db.run(
        `
          INSERT INTO event_log (
            id,
            created_at,
            actor_username,
            actor_role,
            kind,
            action,
            target_type,
            target_id,
            status,
            message,
            details_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        payload.id,
        payload.createdAt,
        payload.actorUsername,
        payload.actorRole,
        payload.kind,
        payload.action,
        payload.targetType,
        payload.targetId,
        payload.status,
        payload.message,
        JSON.stringify(payload.details)
      );
    },

    async listEvents({ limit = 200 } = {}) {
      const bounded = Math.max(10, Math.min(1000, Number(limit) || 200));
      const rows = await db.all(
        `
          SELECT
            id,
            created_at,
            actor_username,
            actor_role,
            kind,
            action,
            target_type,
            target_id,
            status,
            message,
            details_json
          FROM event_log
          ORDER BY created_at DESC
          LIMIT ?
        `,
        bounded
      );
      return (rows || []).map((row) => {
        let details = {};
        try {
          details = JSON.parse(String(row.details_json || '{}'));
        } catch {}
        return {
          id: String(row.id || ''),
          createdAt: Number(row.created_at || 0),
          actorUsername: String(row.actor_username || ''),
          actorRole: String(row.actor_role || ''),
          kind: String(row.kind || ''),
          action: String(row.action || ''),
          targetType: String(row.target_type || ''),
          targetId: String(row.target_id || ''),
          status: String(row.status || ''),
          message: String(row.message || ''),
          details,
        };
      });
    },

    async pruneEvents(limit = 2000) {
      await db.run(
        `
          DELETE FROM event_log
          WHERE id IN (
            SELECT id
            FROM event_log
            ORDER BY created_at DESC
            LIMIT -1 OFFSET ?
          )
        `,
        Math.max(200, Number(limit) || 2000)
      );
    },

    async createAiConversation(conversation) {
      const now = Number(conversation.createdAt || Date.now());
      await db.run('INSERT INTO ai_conversations (id, username, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', String(conversation.id), String(conversation.username), String(conversation.title || 'New conversation'), now, now);
      return { id: String(conversation.id), title: String(conversation.title || 'New conversation'), createdAt: now, updatedAt: now };
    },

    async listAiConversations(username) {
      const rows = await db.all('SELECT id, title, created_at, updated_at FROM ai_conversations WHERE username = ? ORDER BY updated_at DESC LIMIT 50', String(username));
      return (rows || []).map((row) => ({ id: row.id, title: row.title, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }));
    },

    async getAiConversation(id, username) {
      const row = await db.get('SELECT id, title, created_at, updated_at FROM ai_conversations WHERE id = ? AND username = ?', String(id), String(username));
      return row ? { id: row.id, title: row.title, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) } : null;
    },

    async nameAiConversation(id, username, title) {
      const result = await db.run(
        'UPDATE ai_conversations SET title = ? WHERE id = ? AND username = ? AND title = ?',
        String(title),
        String(id),
        String(username),
        'New conversation'
      );
      return Number(result.changes || 0) > 0;
    },

    async deleteAiConversation(id, username) {
      await db.run('DELETE FROM ai_pending_actions WHERE conversation_id = ? AND username = ?', String(id), String(username));
      await db.run('DELETE FROM ai_messages WHERE conversation_id = ? AND username = ?', String(id), String(username));
      const result = await db.run('DELETE FROM ai_conversations WHERE id = ? AND username = ?', String(id), String(username));
      return Number(result.changes || 0) > 0;
    },

    async appendAiMessage(message) {
      const createdAt = Number(message.createdAt || Date.now());
      await db.run('INSERT INTO ai_messages (id, conversation_id, username, role, content_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', String(message.id), String(message.conversationId), String(message.username), String(message.role), JSON.stringify(message.content ?? ''), createdAt);
      await db.run('UPDATE ai_conversations SET updated_at = ? WHERE id = ? AND username = ?', createdAt, String(message.conversationId), String(message.username));
      await db.run(`DELETE FROM ai_messages WHERE id IN (SELECT id FROM ai_messages WHERE conversation_id = ? AND username = ? ORDER BY created_at DESC LIMIT -1 OFFSET 100)`, String(message.conversationId), String(message.username));
      return { id: String(message.id), conversationId: String(message.conversationId), role: String(message.role), content: message.content ?? '', createdAt };
    },

    async listAiMessages(conversationId, username) {
      const rows = await db.all('SELECT id, role, content_json, created_at FROM ai_messages WHERE conversation_id = ? AND username = ? ORDER BY created_at ASC LIMIT 100', String(conversationId), String(username));
      return (rows || []).map((row) => {
        let content = '';
        try { content = JSON.parse(row.content_json); } catch { content = String(row.content_json || ''); }
        return { id: row.id, role: row.role, content, createdAt: Number(row.created_at) };
      });
    },

    async createAiPendingAction(action) {
      await db.run(`INSERT INTO ai_pending_actions (id, conversation_id, username, action_type, args_json, preview_json, status, idempotency_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`, String(action.id), String(action.conversationId), String(action.username), String(action.actionType), JSON.stringify(action.args || {}), JSON.stringify(action.preview || {}), String(action.idempotencyKey), Number(action.createdAt), Number(action.expiresAt));
      return action;
    },

    async getAiPendingAction(id, username) {
      const row = await db.get('SELECT * FROM ai_pending_actions WHERE id = ? AND username = ?', String(id), String(username));
      if (!row) return null;
      let args = {}, preview = {};
      try { args = JSON.parse(row.args_json); } catch {}
      try { preview = JSON.parse(row.preview_json); } catch {}
      return { id: row.id, conversationId: row.conversation_id, username: row.username, actionType: row.action_type, args, preview, status: row.status, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), confirmedAt: Number(row.confirmed_at || 0) };
    },

    async consumeAiPendingAction(id, username) {
      const now = Date.now();
      const result = await db.run(`UPDATE ai_pending_actions SET status = 'executing', confirmed_at = ? WHERE id = ? AND username = ? AND status = 'pending' AND expires_at > ?`, now, String(id), String(username), now);
      if (!Number(result.changes || 0)) return null;
      return this.getAiPendingAction(id, username);
    },

    async finishAiPendingAction(id, username, status) {
      await db.run('UPDATE ai_pending_actions SET status = ? WHERE id = ? AND username = ?', String(status), String(id), String(username));
    },

    async rejectAiPendingAction(id, username) {
      const result = await db.run("UPDATE ai_pending_actions SET status = 'rejected' WHERE id = ? AND username = ? AND status = 'pending'", String(id), String(username));
      return Number(result.changes || 0) > 0;
    },

    async pruneAiData() {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      await db.run('DELETE FROM ai_pending_actions WHERE expires_at < ?', Date.now());
      await db.run('DELETE FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE updated_at < ?)', cutoff);
      await db.run('DELETE FROM ai_conversations WHERE updated_at < ?', cutoff);
    },
  };
}
