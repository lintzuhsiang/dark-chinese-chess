import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfflineDiagnostics, parseOfflineDiagnostics } from '../src/replay/OfflineDiagnostics';
import type { ReplayView } from '../src/replay/model';

describe('offline trace import boundary', () => {
  it('rejects malformed, incompatible and unbounded artifacts', () => {
    for (const value of [
      '{',
      '{}',
      JSON.stringify({
        schema: 'ai-search-diagnostics-v1',
        mode: 'diagnostic-only',
        reportSha256: 'a'.repeat(64),
        traces: Array(25).fill({}),
      }),
    ])
      expect(() => parseOfflineDiagnostics(value)).toThrow();
    expect(
      parseOfflineDiagnostics(
        JSON.stringify({
          schema: 'ai-search-diagnostics-v1',
          mode: 'diagnostic-only',
          reportSha256: 'a'.repeat(64),
          traces: [],
        }),
      ).mode,
    ).toBe('diagnostic-only');
  });
  it('ordinary replay has explicit missing diagnostics and no policy execution', () => {
    const markup = renderToStaticMarkup(
      createElement(OfflineDiagnostics, {
        view: { match: { seed: 1, leg: 0 }, cursor: 0 } as ReplayView,
        reportHash: 'a'.repeat(64),
      }),
    );
    expect(markup).toContain('Not recorded.');
    expect(markup).toContain('No AI runs in this browser.');
  });
});
