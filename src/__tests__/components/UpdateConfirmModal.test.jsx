import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { UpdateConfirmModal } from '../../components/common.jsx';

describe('UpdateConfirmModal', () => {
  test('shows update details and requires explicit confirmation', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<UpdateConfirmModal open currentVersion="0.2.27-beta" targetVersion="0.2.28-beta" channel="dev" onCancel={onCancel} onConfirm={onConfirm} />);

    expect(screen.getByRole('dialog', { name: /start caddyui update/i })).toBeInTheDocument();
    expect(screen.getByText('v0.2.27-beta')).toBeInTheDocument();
    expect(screen.getByText('v0.2.28-beta')).toBeInTheDocument();
    expect(screen.getByText('dev')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /start update/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('can be cancelled without starting an update', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<UpdateConfirmModal open currentVersion="1.0.0" targetVersion="1.1.0" channel="stable" onCancel={onCancel} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /keep current version/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
