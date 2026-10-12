// Every test must finish without console errors or warnings (the "no console errors" requirement).
import { beforeEach, afterEach, expect, vi } from 'vitest';

let spies;
beforeEach(() => { spies = { error: vi.spyOn(console, 'error').mockImplementation(() => {}), warn: vi.spyOn(console, 'warn').mockImplementation(() => {}) }; });
afterEach(() => {
  const calls = [...spies.error.mock.calls, ...spies.warn.mock.calls];
  spies.error.mockRestore(); spies.warn.mockRestore();
  expect(calls, 'unexpected console.error/warn output').toEqual([]);
});
