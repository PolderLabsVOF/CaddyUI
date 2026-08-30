import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Proxies from '../../pages/Proxies.jsx';

function makeSite(id, host = `host-${id}.example.com`, upstream = '127.0.0.1:8080', extras = {}) {
  return {
    id,
    line: Number(id.split('-').pop()) || 5,
    addresses: [host],
    description: '',
    category: 'web',
    tags: [],
    imports: [],
    proxies: [{ upstreams: [upstream], imports: [] }],
    disabled: false,
    ...extras,
  };
}

function renderProxies({ api, sites, ...rest } = {}) {
  const defaultSites = [
    makeSite('s-1'),
    makeSite('s-2'),
    makeSite('s-3'),
    makeSite('s-4'),
  ];
  const props = {
    config: {
      path: 'Caddyfile',
      content: '',
      parsed: { sites: sites || defaultSites, snippets: [] },
      health: {},
    },
    refresh: vi.fn(),
    refreshHealth: vi.fn(),
    setConfig: vi.fn(),
    canEdit: true,
    theme: 'dark',
    health: {},
    loading: false,
    api: api || vi.fn(),
    templates: [],
    templateToApply: null,
    onTemplateApplied: vi.fn(),
    onConfigChanged: vi.fn(),
    onHealthPatch: vi.fn(),
    notify: vi.fn(),
    ...rest,
  };
  return render(<Proxies {...props} />);
}

describe('Proxies bulk + selection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('Proxies_selectAllHeader_indeterminateWhenPartialSelection', async () => {
    // Arrange — render with 4 sites and partial selection (1 of 4)
    renderProxies();
    const checkboxes = screen.getAllByRole('checkbox', { name: /Select /i });
    // Section header is the first checkbox (Select all visible), rows follow.
    // Select 1 row via clicking its checkbox.
    fireEvent.click(checkboxes[1]);
    // Act — read the header checkbox element by name
    const headerCheckbox = screen.getByRole('checkbox', { name: /Select all visible/i });
    // Assert
    expect(headerCheckbox.indeterminate).toBe(true);
  });

  test('Proxies_bulkDisable_callsApiOnceWithActionArray', async () => {
    // Arrange — mock the api and capture all calls
    const api = vi.fn().mockResolvedValue({ ok: true, applied: 3, content: '', parsed: { sites: [], snippets: [] } });
    renderProxies({ api });
    const rowCheckboxes = screen.getAllByRole('checkbox', { name: /Select /i });
    // Select first 3 rows
    fireEvent.click(rowCheckboxes[1]);
    fireEvent.click(rowCheckboxes[2]);
    fireEvent.click(rowCheckboxes[3]);
    // Act — click the Disable button in the bulk action bar
    const disableBtn = screen.getByRole('button', { name: /^Disable$/i });
    fireEvent.click(disableBtn);
    // Assert — exactly one POST to bulk-disabled with expected shape
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const [path, options] = api.mock.calls[0];
    expect(path).toBe('/api/proxies/bulk-disabled');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(Array.isArray(body.actions)).toBe(true);
    expect(body.actions).toHaveLength(3);
    body.actions.forEach((a) => {
      expect(typeof a.line).toBe('number');
      expect(a.disabled).toBe(true);
    });
  });

  test('Proxies_bulkDisableFailure_preservesSelection', async () => {
    // Arrange — mock api to throw on bulk-disabled
    const api = vi.fn().mockRejectedValue(new Error('Server exploded'));
    renderProxies({ api });
    const rowCheckboxes = screen.getAllByRole('checkbox', { name: /Select /i });
    fireEvent.click(rowCheckboxes[1]);
    fireEvent.click(rowCheckboxes[2]);
    fireEvent.click(rowCheckboxes[3]);
    // Act — click the Disable button
    const disableBtn = screen.getByRole('button', { name: /^Disable$/i });
    fireEvent.click(disableBtn);
    // Wait for the failure path to restore selection
    await waitFor(() => expect(api).toHaveBeenCalled());
    // Assert — all three row checkboxes remain checked
    const after = screen.getAllByRole('checkbox', { name: /Select /i });
    // After failure, selection should still be intact: rows 1,2,3 checked.
    expect(after[1].checked).toBe(true);
    expect(after[2].checked).toBe(true);
    expect(after[3].checked).toBe(true);
  });

  test('Proxies_toggleDisabled_invokesOnHealthPatch', async () => {
    // Arrange — track health patches and api call
    const onHealthPatch = vi.fn();
    const api = vi.fn().mockResolvedValue({
      ok: true,
      content: '',
      parsed: { sites: [], snippets: [] },
      health: { 's-1': { local: { online: true } } },
    });
    renderProxies({ api, onHealthPatch });
    // Act — open the first row's menu and click Disable
    const triggers = screen.getAllByRole('button', { name: /row actions/i });
    fireEvent.click(triggers[0]);
    const disableItem = await screen.findByRole('menuitem', { name: /Disable/i });
    fireEvent.click(disableItem);
    // Assert — onHealthPatch was called at least once with a patch keyed by s-1
    await waitFor(() => expect(onHealthPatch).toHaveBeenCalled());
    const patchArg = onHealthPatch.mock.calls
      .map(([arg]) => arg)
      .find((arg) => arg && Object.prototype.hasOwnProperty.call(arg, 's-1'));
    expect(patchArg).toBeTruthy();
  });
});
