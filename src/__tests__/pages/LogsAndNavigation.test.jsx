import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import Logs from '../../pages/Logs.jsx';
import { pageItems } from '../../components/common.jsx';

describe('logs and API-only navigation', () => {
  test('enhanced Logs page exposes diagnostics, filters, raw view, and event history', async () => {
    const api = vi.fn(async (url) => {
      if (url.startsWith('/api/logs')) return { logs: [{ source: 'journalctl:caddy', ok: true, content: '{"level":"error","msg":"upstream failed"}' }] };
      if (url.startsWith('/api/events')) return { events: [] };
      return {};
    });

    render(<Logs api={api} />);

    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('/api/logs')));
    expect(screen.getByRole('textbox', { name: /search system logs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /errors/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raw' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /event log/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /auto refresh/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /event log/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/events?limit=250'));
    expect(screen.getByRole('heading', { name: /activity history/i })).toBeInTheDocument();
  });

  test('does not expose the legacy Caddyfile configuration editor in navigation', () => {
    expect(pageItems.map(([id]) => id)).not.toContain('configuration');
    expect(pageItems.map(([id]) => id)).toContain('caddy');
  });
});
