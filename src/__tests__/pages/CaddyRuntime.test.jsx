import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import CaddyRuntime from '../../pages/CaddyRuntime.jsx';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }) => <textarea aria-label="JSON editor" value={value} onChange={(event) => onChange?.(event.target.value)} />,
}));

const config = {
  apps: {
    http: {
      servers: {
        srv0: {
          listen: [':443'],
          protocols: ['h1', 'h2', 'h3'],
          routes: [{ handle: [{ handler: 'static_response', body: '', custom_option: null }] }],
        },
      },
    },
    tls: { automation: { policies: [{ subjects: ['example.com'] }] } },
  },
  logging: { logs: { default: { level: 'INFO' } } },
};

describe('Caddy runtime control', () => {
  test('shows live servers, observability, and the complete JSON API tree', async () => {
    const api = vi.fn(async (url) => {
      if (url === '/api/caddy/config') return { ok: true, etag: '"abc"', value: config };
      if (url === '/api/caddy/metrics') return { summary: { goroutines: 42, requestsInFlight: 3 }, samples: [] };
      if (url === '/api/caddy/reverse_proxy/upstreams') return { ok: true, value: [{ address: '10.0.0.2:8080', num_requests: 2, fails: 0 }] };
      return { ok: true, value: {} };
    });

    render(<CaddyRuntime api={api} canEdit theme="dark" notify={vi.fn()} />);

    await screen.findByRole('heading', { name: /caddy runtime/i });
    expect(screen.getByText('42 goroutines')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /http servers/i }));
    expect(await screen.findByText('srv0')).toBeInTheDocument();
    expect(screen.getByText('HTTP/3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /observability/i }));
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.2:8080')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /json api/i }));
    expect(await screen.findByRole('tree', { name: /caddy configuration/i })).toBeInTheDocument();
    expect(screen.getByText('apps')).toBeInTheDocument();
    expect(screen.getByText('logging')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save selected path/i })).toBeDisabled();
  });

  test('saves a server with the current ETag to prevent lost updates', async () => {
    const api = vi.fn(async (url, options = {}) => {
      if (url === '/api/caddy/config') return { ok: true, etag: '"abc"', value: config };
      if (url === '/api/caddy/metrics') return { summary: {}, samples: [] };
      if (url === '/api/caddy/reverse_proxy/upstreams') return { ok: true, value: [] };
      if (url.includes('/api/caddy/config/apps/http/servers/srv0') && !options.method) return { ok: true, etag: '"server-abc"', value: config.apps.http.servers.srv0 };
      if (url.includes('/api/caddy/config/apps/http/servers/srv0') && options.method === 'PATCH') return { ok: true, etag: '"def"' };
      return { ok: true, value: {} };
    });

    render(<CaddyRuntime api={api} canEdit theme="dark" notify={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /http servers/i }));
    await screen.findByText('srv0');
    fireEvent.click(screen.getByRole('button', { name: /edit srv0/i }));
    fireEvent.change(await screen.findByLabelText(/idle timeout/i), { target: { value: '10m' } });
    fireEvent.click(screen.getByRole('button', { name: /save server/i }));

    await waitFor(() => expect(api).toHaveBeenCalledWith(
      '/api/caddy/config/apps/http/servers/srv0',
      expect.objectContaining({ method: 'PATCH', headers: { 'If-Match': '"server-abc"' } }),
    ));
    const [, options] = api.mock.calls.find(([url, request = {}]) => url.endsWith('/servers/srv0') && request.method === 'PATCH');
    expect(JSON.parse(options.body).value.routes[0].handle[0]).toMatchObject({ body: '', custom_option: null });
  });

  test('replaces the root config using its ETag instead of an unguarded load', async () => {
    const api = vi.fn(async (url, options = {}) => {
      if (url === '/api/caddy/config' && !options.method) return { ok: true, etag: '"root-etag"', value: config };
      if (url === '/api/caddy/metrics') return { summary: {}, samples: [] };
      if (url === '/api/caddy/reverse_proxy/upstreams') return { ok: true, value: [] };
      return { ok: true, value: {} };
    });

    render(<CaddyRuntime api={api} canEdit canAdmin theme="dark" notify={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /json api/i }));
    const editor = await screen.findByRole('textbox', { name: /json editor/i });
    fireEvent.change(editor, { target: { value: JSON.stringify({ ...config, admin: { disabled: false } }) } });
    fireEvent.click(screen.getByRole('button', { name: /save selected path/i }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/caddy/config', expect.objectContaining({
      method: 'PATCH',
      headers: { 'If-Match': '"root-etag"' },
    })));
  });
});
