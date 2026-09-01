import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { renderAssistantMarkdown } from '../../components/markdown.jsx';

describe('renderAssistantMarkdown', () => {
  test('renders plain text without HTML-escaping characters', () => {
    const { container } = render(<div>{renderAssistantMarkdown("I'm doing well, thanks for asking!")}</div>);
    // The rendered text node must contain a literal apostrophe, not the entity.
    expect(container.textContent).toBe("I'm doing well, thanks for asking!");
    expect(container.innerHTML).not.toContain('&#39;');
    expect(container.innerHTML).not.toContain('&amp;#39;');
  });

  test('renders double quotes as literal quotes', () => {
    const { container } = render(<div>{renderAssistantMarkdown('He said "hello".')}</div>);
    expect(container.textContent).toBe('He said "hello".');
    expect(container.innerHTML).not.toContain('&quot;');
  });

  test('renders ampersand as literal character', () => {
    const { container } = render(<div>{renderAssistantMarkdown('Plain & undecorated')}</div>);
    expect(container.textContent).toBe('Plain & undecorated');
    // React will encode the & on the way out for HTML safety; the rendered
    // textContent should still be the literal ampersand.
    expect(container.innerHTML).not.toContain('&amp;amp;');
  });

  test('escapes HTML tags inside text', () => {
    const { container } = render(<div>{renderAssistantMarkdown('Use <script>alert(1)</script> tags')}</div>);
    expect(container.textContent).toBe('Use <script>alert(1)</script> tags');
    // No actual <script> element should be created.
    expect(container.querySelector('script')).toBeNull();
  });

  test('still supports bold and inline code', () => {
    const { container } = render(<div>{renderAssistantMarkdown('Run `npm test` and see **great** results.')}</div>);
    expect(container.querySelector('code')?.textContent).toBe('npm test');
    expect(container.querySelector('strong')?.textContent).toBe('great');
    expect(container.textContent).toBe('Run npm test and see great results.');
  });
});
