import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Proxies from '../../pages/Proxies.jsx';
import { HEALTH_POLL_INTERVAL_MS } from '../../App.jsx';

function makeSite(id) {
  return {
    id,
    line: 5,
    addresses: [`host-${id}.example.com`],
    description: '',
    category: 'web',
    tags: [],
    imports: [],
    proxies: [{ upstreams: ['127.0.0.1:8080'], imports: [] }],
    disabled: false,
  };
}

function renderProxies({ refreshHealth, sites }) {
  const defaultSites = [makeSite('s-1'), makeSite('s-2')];
  return render(
    <Proxies
      config={{ path: 'Caddyfile', content: '', parsed: { sites: sites || defaultSites, snippets: [] }, health: {} }}
      refresh={vi.fn()}
      refreshHealth={refreshHealth}
      setConfig={vi.fn()}
      canEdit
      theme="dark"
      health={{}}
      loading={false}
      api={vi.fn()}
      templates={[]}
      templateToApply={null}
      onTemplateApplied={vi.fn()}
      onConfigChanged={vi.fn()}
      onHealthPatch={vi.fn()}
      notify={vi.fn()}
    />
  );
}

describe('Proxies health polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('Proxies_polling_callsRefreshHealthEveryIntervalUntilUnmount', () => {
    // Arrange
    const refreshHealth = vi.fn();
    const utils = renderProxies({ refreshHealth });
    // Act — advance 30s, expect one call; unmount; advance another 30s, no new calls
    vi.advanceTimersByTime(HEALTH_POLL_INTERVAL_MS);
    expect(refreshHealth).toHaveBeenCalledTimes(1);
    utils.unmount();
    vi.advanceTimersByTime(HEALTH_POLL_INTERVAL_MS);
    // Assert — no further calls after unmount
    expect(refreshHealth).toHaveBeenCalledTimes(1);
  });
});
