import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import SettingsPage from '../../pages/SettingsPage.jsx';

const settings = {
  username: 'admin',
  role: 'admin',
  caddyApiUrl: 'http://127.0.0.1:2019',
  hasCaddyApiSecret: true,
  logPaths: ['/var/log/caddy/access.log'],
  updateChannel: 'dev',
  trustProxyHops: 1,
  secureCookieMode: 'auto',
  allowedOrigins: [],
};

describe('settings layout', () => {
  test('renders every settings section as a navigable panel', async () => {
    const api = vi.fn(async (path) => path === '/api/users' ? { users: [] } : { discovered: { logfiles: [] } });
    render(<SettingsPage settings={settings} setSettings={vi.fn()} canEdit canAdmin api={api} notify={vi.fn()} theme="dark" setTheme={vi.fn()} accent="violet" setAccent={vi.fn()} />);

    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/users'));
    for (const [button, heading] of [
      ['AI assistant', 'AI assistant'],
      ['Security', 'Security'],
      ['Appearance', 'Appearance'],
      ['Account', 'Password'],
      ['Users', 'Users'],
      ['Updates', 'Updates'],
      ['Danger', 'Danger zone'],
      ['Connection', 'Connection'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(button, 'i') }));
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
  });

  test('appearance controls update browser theme and accent', () => {
    const setTheme = vi.fn();
    const setAccent = vi.fn();
    render(<SettingsPage settings={settings} setSettings={vi.fn()} canEdit canAdmin api={vi.fn(async () => ({ users: [] }))} notify={vi.fn()} theme="dark" setTheme={setTheme} accent="violet" setAccent={setAccent} />);

    fireEvent.click(screen.getByRole('button', { name: /appearance/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rose' }));
    expect(setTheme).toHaveBeenCalledWith('light');
    expect(setAccent).toHaveBeenCalledWith('rose');
  });
});
