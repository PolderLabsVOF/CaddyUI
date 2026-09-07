import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ProxyRow } from '../../components/common.jsx';

const site = {
  id: 'site-1',
  line: 4,
  addresses: ['app.example.com'],
  description: 'App',
  category: 'internal',
  tags: ['prod'],
  imports: [],
  proxies: [{ upstreams: ['10.0.2.20:8080'], imports: [] }],
  disabled: false,
};

describe('ProxyRow', () => {
  test('uses seven aligned cells and a compact accessible actions menu', () => {
    const onEdit = vi.fn();
    const { container } = render(<ProxyRow site={site} healthCheck={{ online: true }} canEdit onEdit={onEdit} onDelete={vi.fn()} onToggleDisabled={vi.fn()} />);
    expect(container.querySelector('.proxy-row-main').children).toHaveLength(7);
    expect(container.querySelector('.proxy-state')).toBeNull();
    const trigger = screen.getByRole('button', { name: /actions for app\.example\.com/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test('shows an indeterminate state before a health result arrives', () => {
    render(<ProxyRow site={site} canEdit={false} onEdit={vi.fn()} onDelete={vi.fn()} onToggleDisabled={vi.fn()} />);
    expect(screen.getByText('checking')).toBeInTheDocument();
    expect(screen.queryByText('offline')).toBeNull();
  });
});
