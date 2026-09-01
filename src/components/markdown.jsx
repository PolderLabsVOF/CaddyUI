import React, { Fragment } from 'react';

// Minimal, safe-ish Markdown renderer for AI assistant messages.
// Supports: paragraphs, headings, **bold**, *italic*, `code`, fenced ```code```,
// unordered lists, ordered lists, simple | pipe | tables, and inline links.
// Escapes any raw HTML. Not a full CommonMark implementation, but covers the
// patterns the AI assistant actually emits.

const TOKEN_OPEN = '';
const TOKEN_CLOSE = '';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value = '') {
  return escapeHtml(value).replaceAll('\n', ' ');
}

function splitTableRow(line = '') {
  const trimmed = String(line || '').trim().replace(/^\||\|$/g, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line = '') {
  const trimmed = String(line || '').trim().replace(/^\||\|$/g, '');
  if (!trimmed) return false;
  return trimmed.split('|').every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function renderTableRow(cells, isHeader = false) {
  return (
    <tr>
      {cells.map((cell, index) => (
        React.createElement(isHeader ? 'th' : 'td', { key: index }, renderInline(cell))
      ))}
    </tr>
  );
}

function renderInline(text) {
  if (text == null) return null;
  const safe = escapeHtml(text);
  const tokens = [];
  let working = safe;

  // Inline code: `code` — render first so its content isn't re-interpreted.
  working = working.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = tokens.length;
    tokens.push(<code key={`c-${index}`} className="ai-md-code-inline">{code}</code>);
    return `${TOKEN_OPEN}${index}${TOKEN_CLOSE}`;
  });

  // Links: [label](https://...)
  working = working.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
    const index = tokens.length;
    tokens.push(
      <a key={`l-${index}`} className="ai-md-link" href={escapeAttr(url)} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
    return `${TOKEN_OPEN}${index}${TOKEN_CLOSE}`;
  });

  // Bold: **text** or __text__
  working = working.replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_match, a, b) => {
    const value = a || b;
    const index = tokens.length;
    tokens.push(<strong key={`b-${index}`}>{value}</strong>);
    return `${TOKEN_OPEN}${index}${TOKEN_CLOSE}`;
  });

  // Italic: *text* — only outside of ** pairs (already consumed above).
  working = working.replace(/\*([^*\n]+)\*/g, (_match, value) => {
    const index = tokens.length;
    tokens.push(<em key={`i-${index}`}>{value}</em>);
    return `${TOKEN_OPEN}${index}${TOKEN_CLOSE}`;
  });

  // Italic: _text_
  working = working.replace(/_([^_\n]+)_/g, (_match, value) => {
    const index = tokens.length;
    tokens.push(<em key={`j-${index}`}>{value}</em>);
    return `${TOKEN_OPEN}${index}${TOKEN_CLOSE}`;
  });

  // Walk the string and split on token placeholders.
  const result = [];
  let cursor = 0;
  let buffer = '';
  while (cursor < working.length) {
    const ch = working[cursor];
    if (ch === TOKEN_OPEN) {
      const close = working.indexOf(TOKEN_CLOSE, cursor);
      if (close === -1) {
        buffer += working.slice(cursor);
        cursor = working.length;
        break;
      }
      const index = Number(working.slice(cursor + 1, close));
      if (buffer) {
        result.push(<React.Fragment key={`t-${result.length}`}>{buffer}</React.Fragment>);
        buffer = '';
      }
      if (Number.isFinite(index) && tokens[index]) {
        result.push(tokens[index]);
      }
      cursor = close + 1;
    } else {
      buffer += ch;
      cursor += 1;
    }
  }
  if (buffer) result.push(<React.Fragment key={`t-${result.length}`}>{buffer}</React.Fragment>);
  return result;
}

function renderBlock(lines, start, state) {
  const line = lines[start];
  if (line == null) return start;

  // Fenced code block
  const fenceMatch = /^```(\w+)?\s*$/.exec(line);
  if (fenceMatch) {
    const lang = fenceMatch[1] || '';
    let end = start + 1;
    const body = [];
    while (end < lines.length && !/^```\s*$/.test(lines[end])) {
      body.push(lines[end]);
      end += 1;
    }
    state.nodes.push(
      <pre key={`code-${start}`} className="ai-md-pre">
        <code data-lang={lang || undefined}>{body.join('\n')}</code>
      </pre>
    );
    return Math.min(end + 1, lines.length);
  }

  // Table (header + separator + rows)
  if (start + 1 < lines.length && line.includes('|') && isTableSeparator(lines[start + 1])) {
    const headerCells = splitTableRow(line);
    let end = start + 2;
    const body = [];
    while (end < lines.length && lines[end].includes('|') && lines[end].trim()) {
      body.push(splitTableRow(lines[end]));
      end += 1;
    }
    state.nodes.push(
      <div key={`tbl-${start}`} className="ai-md-table-wrap">
        <table className="ai-md-table">
          <thead>{renderTableRow(headerCells, true)}</thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <Fragment key={`row-${start}-${rowIndex}`}>{renderTableRow(row, false)}</Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
    return end;
  }

  // Heading
  const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const Tag = `h${level + 3}`; // h4, h5, h6 keep visual hierarchy small in chat
    state.nodes.push(
      React.createElement(Tag, { key: `h-${start}`, className: 'ai-md-heading' }, renderInline(headingMatch[2]))
    );
    return start + 1;
  }

  // Unordered list
  if (/^\s*[-*]\s+/.test(line)) {
    const items = [];
    let end = start;
    while (end < lines.length && /^\s*[-*]\s+/.test(lines[end])) {
      items.push(lines[end].replace(/^\s*[-*]\s+/, ''));
      end += 1;
    }
    state.nodes.push(
      <ul key={`ul-${start}`} className="ai-md-list">
        {items.map((item, index) => (
          <li key={`ul-${start}-${index}`}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    return end;
  }

  // Ordered list
  if (/^\s*\d+\.\s+/.test(line)) {
    const items = [];
    let end = start;
    while (end < lines.length && /^\s*\d+\.\s+/.test(lines[end])) {
      items.push(lines[end].replace(/^\s*\d+\.\s+/, ''));
      end += 1;
    }
    state.nodes.push(
      <ol key={`ol-${start}`} className="ai-md-list">
        {items.map((item, index) => (
          <li key={`ol-${start}-${index}`}>{renderInline(item)}</li>
        ))}
      </ol>
    );
    return end;
  }

  // Paragraph: collect contiguous non-empty, non-special lines
  if (line.trim()) {
    const para = [];
    let end = start;
    while (
      end < lines.length
      && lines[end].trim()
      && !/^(#{1,3}\s|```|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[end])
    ) {
      para.push(lines[end]);
      end += 1;
    }
    state.nodes.push(
      <p key={`p-${start}`} className="ai-md-paragraph">{renderInline(para.join(' '))}</p>
    );
    return end;
  }

  // Blank line — skip.
  return start + 1;
}

export function renderAssistantMarkdown(text) {
  if (!text) return null;
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const state = { nodes: [] };
  let cursor = 0;
  while (cursor < lines.length) {
    cursor = renderBlock(lines, cursor, state);
  }
  return <div className="ai-md">{state.nodes}</div>;
}