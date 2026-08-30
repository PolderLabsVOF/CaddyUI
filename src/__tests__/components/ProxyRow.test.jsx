import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ProxyRow } from '../../components/common.jsx';

const baseSite = {
  id: 'site-1',
  line: 5,
  addresses: ['example.com'],
  description: '',
  category: 'web',
  tags: ['prod'],
  imports: [],
  proxies: [{ upstreams: ['127.0.0.1:8080'], imports: [] }],
  disabled: false,
};

const noop = () => {};

function renderRow(overrides = {}) {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onToggleDisabled = vi.fn();
  const onToggleSelect = vi.fn();
  const utils = render(
    <ProxyRow
      site={baseSite}
      selected={new Set()}
      onToggleSelect={onToggleSelect}
      canEdit
      healthCheck={null}
      onEdit={onEdit}
      onDelete={onDelete}
      onToggleDisabled={onToggleDisabled}
      {...overrides}
    />
  );
  return { ...utils, onEdit, onDelete, onToggleDisabled, onToggleSelect };
}

describe('ProxyRow', () => {
  test('ProxyRow_structure_sevenCellsAriaMenuAndNoStateText', () => {
    // Arrange
    const { container } = renderRow();
    const main = container.querySelector('.proxy-row-main');
    const trigger = screen.getByRole('button', { name: /row actions/i });
    const stateMatches = Array.from(container.querySelectorAll('[class*="proxy-state"]'))
      .filter((el) => /enabled|disabled/i.test(el.textContent || ''));
    // Assert — 7 children, expected ARIA on the menu trigger, and no
    // "proxy-state"-classed element exposing "enabled"/"disabled" text.
    expect(main.children.length).toBe(7);
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(stateMatches.length).toBe(0);
  });

  test('ProxyRow_menu_clickingTriggerOpensMenu', () => {
    // Arrange
    renderRow();
    const trigger = screen.getByRole('button', { name: /row actions/i });
    // Act
    fireEvent.click(trigger);
    // Assert
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  test('ProxyRow_menu_outsideMouseDownClosesMenuWithoutRowClick', () => {
    // Arrange
    const { onEdit } = renderRow();
    const trigger = screen.getByRole('button', { name: /row actions/i });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Act — mousedown on document.body should close menu and NOT call onEdit
    fireEvent.mouseDown(document.body);
    // Assert
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(onEdit).not.toHaveBeenCalled();
  });

  test('ProxyRow_menu_escapeKeyClosesMenu', () => {
    // Arrange
    renderRow();
    const trigger = screen.getByRole('button', { name: /row actions/i });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Act
    fireEvent.keyDown(document, { key: 'Escape' });
    // Assert
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  test('ProxyRow_menu_clickingTriggerDoesNotFireRowClick', () => {
    // Arrange
    const { onEdit } = renderRow();
    const trigger = screen.getByRole('button', { name: /row actions/i });
    // Act
    fireEvent.click(trigger);
    // Assert
    expect(onEdit).not.toHaveBeenCalled();
  });
});
