import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { Shell } from '../../components/common.jsx';

describe('Shell', () => {
  test('uses icon-backed update actions that collapse without raw text overflow', () => {
    const { container } = render(
      <Shell
        page="proxies"
        setPage={vi.fn()}
        collapsed
        setCollapsed={vi.fn()}
        user="admin"
        onLogout={vi.fn()}
        theme="dark"
        setTheme={vi.fn()}
        appInfo={{ version: '1.0.0', availableVersion: '1.1.0', updateAvailable: true }}
        onCheckUpdates={vi.fn()}
        onRunUpdate={vi.fn()}
        canUpdate
        checkingUpdates={false}
        updating={false}
        canEdit={false}
        appVersion="1.0.0"
      >
        <div>Content</div>
      </Shell>
    );

    const checkButton = screen.getByRole('button', { name: 'Check for updates' });
    const updateButton = screen.getByRole('button', { name: 'Update to v1.1.0' });
    expect(container.querySelector('.sidebar')).toHaveClass('collapsed');
    expect(checkButton.querySelector('svg')).toBeInTheDocument();
    expect(checkButton.querySelector('span')).toHaveTextContent('Check updates');
    expect(updateButton.querySelector('svg')).toBeInTheDocument();
    expect(updateButton.querySelector('span')).toHaveTextContent('Update to v1.1.0');
  });
});
