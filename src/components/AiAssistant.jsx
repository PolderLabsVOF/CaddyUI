import React, { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, MessageSquarePlus, Send, Sparkles, Trash2, X } from 'lucide-react';
import { Notice } from './common.jsx';
import { renderAssistantMarkdown } from './markdown.jsx';

const localTest = import.meta.env.DEV && import.meta.env.VITE_CADDYUI_LOCAL_TEST === '1';

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  return String(message?.content?.text || '');
}

function messageProposals(message) {
  return Array.isArray(message?.content?.proposals) ? message.content.proposals : [];
}

function actionLabel(type = '') {
  return String(type).replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase());
}

export default function AiAssistant({ api, settings, canAdmin, onActionComplete, onOpenSettings, notify }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(localTest ? { enabled: true, configured: true, provider: 'openai', model: 'local-test', canEdit: true } : null);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const listRef = useRef(null);

  const configured = localTest || Boolean(status?.configured || (settings?.aiEnabled && settings?.hasAiApiKey && settings?.aiBaseUrl && settings?.aiModel));
  const visible = localTest || Boolean(settings?.aiEnabled || canAdmin);

  const loadStatus = async () => {
    if (localTest) return;
    try { setStatus(await api('/api/ai/status')); } catch { setStatus(null); }
  };

  const loadConversations = async () => {
    if (localTest) return;
    const result = await api('/api/ai/conversations');
    setConversations(result.conversations || []);
    return result.conversations || [];
  };

  const loadMessages = async (id) => {
    if (!id) { setMessages([]); return; }
    if (localTest) { setMessages([{ id: 'welcome', role: 'assistant', content: 'Ask me to inspect or create a proxy.' }]); return; }
    const result = await api(`/api/ai/conversations/${encodeURIComponent(id)}/messages`);
    setMessages(result.messages || []);
  };

  const createConversation = async () => {
    setError('');
    if (localTest) { setConversationId('local'); setMessages([]); return 'local'; }
    const result = await api('/api/ai/conversations', { method: 'POST', body: JSON.stringify({ title: 'New conversation' }) });
    setConversations((current) => [result.conversation, ...current]);
    setConversationId(result.conversation.id);
    setMessages([]);
    return result.conversation.id;
  };

  useEffect(() => { loadStatus(); }, [settings?.aiEnabled, settings?.aiProvider, settings?.aiBaseUrl, settings?.aiModel, settings?.hasAiApiKey]);

  useEffect(() => {
    if (!open || !configured) return;
    loadConversations().then((items) => {
      if (!conversationId && items?.[0]) setConversationId(items[0].id);
    }).catch((err) => setError(err.message));
  }, [open, configured]);

  useEffect(() => {
    if (!open || !conversationId) return;
    loadMessages(conversationId).catch((err) => setError(err.message));
  }, [open, conversationId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (event) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setDraft('');
    try {
      const id = conversationId || await createConversation();
      const userMessage = { id: `pending-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() };
      setMessages((current) => [...current, userMessage]);
      if (localTest) {
        setMessages((current) => [...current, { id: `local-${Date.now()}`, role: 'assistant', content: { text: `I can prepare a proxy proposal for: ${text}`, proposals: [] }, createdAt: Date.now() }]);
      } else {
        const response = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}/messages`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        const result = contentType.includes('application/json') ? await response.json() : { error: await response.text() };
        if (!response.ok) throw new Error(result.error || `Request failed: ${response.status}`);
        setMessages((current) => [...current.filter((item) => item.id !== userMessage.id), userMessage, result.message]);
        await loadConversations();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAction = async (proposal, decision) => {
    if (localTest) return;
    setActionBusy(proposal.id);
    setError('');
    try {
      const result = await api(`/api/ai/actions/${encodeURIComponent(proposal.id)}/${decision}`, { method: 'POST' });
      notify?.({ ok: true, message: decision === 'confirm' ? (result.message || `${actionLabel(proposal.actionType)} completed.`) : 'AI action rejected.', eventId: result.event?.id || '' });
      if (decision === 'confirm') onActionComplete?.(result);
      await loadMessages(conversationId);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusy('');
    }
  };

  const removeConversation = async () => {
    if (!conversationId || localTest) return;
    await api(`/api/ai/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
    const remaining = conversations.filter((conversation) => conversation.id !== conversationId);
    setConversations(remaining);
    setConversationId(remaining[0]?.id || '');
    setMessages([]);
  };

  if (!visible) return null;

  return (
    <>
      <button type="button" className="ai-assistant-trigger" onClick={() => setOpen((current) => !current)} aria-label={open ? 'Close AI assistant' : 'Open AI assistant'} aria-expanded={open}>
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>
      {open && (
        <aside className="ai-assistant-panel" aria-label="AI assistant">
          <header className="ai-assistant-head">
            <div><span><Bot size={18} /> AI assistant</span><small>{configured ? `${status?.provider || settings?.aiProvider} · ${status?.model || settings?.aiModel}` : 'Setup required'}</small></div>
            <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close AI assistant"><X size={18} /></button>
          </header>
          {!configured ? (
            <div className="ai-assistant-setup"><Sparkles size={30} /><h3>Configure the assistant</h3><p>Add a provider, base URL, API key, and model in Settings.</p>{canAdmin && <button type="button" className="primary" onClick={() => { setOpen(false); onOpenSettings?.(); }}>Open AI settings</button>}</div>
          ) : (
            <>
              <div className="ai-conversation-toolbar">
                <label><ChevronDown size={15} /><select value={conversationId} onChange={(event) => setConversationId(event.target.value)} aria-label="AI conversation"><option value="">New conversation</option>{conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select></label>
                <button type="button" className="icon-button" onClick={createConversation} aria-label="New AI conversation"><MessageSquarePlus size={17} /></button>
                <button type="button" className="icon-button" onClick={removeConversation} disabled={!conversationId} aria-label="Delete AI conversation"><Trash2 size={17} /></button>
              </div>
              {error && <Notice type="error">{error}</Notice>}
              <div className="ai-message-list" ref={listRef} aria-live="polite">
                {!messages.length && <div className="ai-welcome"><Sparkles size={24} /><h3>What should I manage?</h3><p>Try: “Create a proxy for app.example.com to 127.0.0.1:3000.”</p></div>}
                {messages.map((message) => (
                  <div key={message.id} className={`ai-message ${message.role}`}>
                    <div className={`ai-message-content ${message.role === 'assistant' ? 'ai-message-rich' : ''}`}>
                      {message.role === 'assistant'
                        ? renderAssistantMarkdown(messageText(message))
                        : messageText(message)}
                    </div>
                    {messageProposals(message).map((proposal) => (
                      <div className={`ai-action-card ${proposal.actionType === 'delete_proxy' || proposal.actionType === 'reload_caddy' ? 'danger' : ''}`} key={proposal.id}>
                        <b>{actionLabel(proposal.actionType)}</b>
                        <pre>{JSON.stringify(proposal.preview?.args || proposal.args || {}, null, 2)}</pre>
                        <small>Expires {new Date(proposal.expiresAt).toLocaleTimeString()}</small>
                        <div className="toolbar"><button type="button" className="primary" onClick={() => handleAction(proposal, 'confirm')} disabled={actionBusy === proposal.id}>{actionBusy === proposal.id ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Confirm</button><button type="button" onClick={() => handleAction(proposal, 'reject')} disabled={actionBusy === proposal.id}>Reject</button></div>
                      </div>
                    ))}
                  </div>
                ))}
                {busy && (
                  <div className="ai-message assistant ai-thinking" aria-label="Assistant is thinking">
                    <span className="ai-thinking-dots" aria-hidden="true"><span /><span /><span /></span>
                    <span className="ai-thinking-label">Thinking…</span>
                  </div>
                )}
              </div>
              <form className="ai-composer" onSubmit={send}>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 8000))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) send(event); }} placeholder="Ask about or manage proxies…" rows={3} disabled={busy} />
                <button type="submit" className="primary" disabled={busy || !draft.trim()} aria-label="Send message"><Send size={17} /></button>
              </form>
            </>
          )}
        </aside>
      )}
    </>
  );
}
