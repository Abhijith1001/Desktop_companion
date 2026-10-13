import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { silentLog } from './helpers.js';
const require = createRequire(import.meta.url);
const { createCommunity } = require('../../electron/services/community');

function fakeSettings(over = {}) {
  const values = { sync: { serverUrl: 'https://example.test/' }, crashReports: false, ...over };
  const internal = {};
  return {
    get: (k) => values[k],
    getInternal: (k) => internal[k],
    setInternal: (k, v) => { internal[k] = v; },
  };
}
const ok = (body = {}) => Promise.resolve({ ok: true, status: 200, json: async () => body });

describe('community service', () => {
  it('posts feedback with app version to the public endpoint', async () => {
    const fetchImpl = vi.fn(() => ok({ id: '1' }));
    const c = createCommunity({ settings: fakeSettings(), log: silentLog, appVersion: '2.2.0', fetchImpl });
    await c.sendFeedback({ kind: 'idea', message: 'More cats', email: '' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.test/api/public/feedback');
    expect(JSON.parse(init.body)).toMatchObject({ kind: 'idea', message: 'More cats', appVersion: '2.2.0' });
  });

  it('sends crash reports only when the user opted in, once per error', async () => {
    const fetchImpl = vi.fn(() => ok());
    const off = createCommunity({ settings: fakeSettings(), log: silentLog, appVersion: '1', fetchImpl });
    off.reportCrash({ message: 'boom' });
    expect(fetchImpl).not.toHaveBeenCalled();

    const on = createCommunity({ settings: fakeSettings({ crashReports: true }), log: silentLog, appVersion: '1', fetchImpl });
    on.reportCrash({ message: 'boom', stack: 's' });
    on.reportCrash({ message: 'boom', stack: 's' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('hides dismissed announcements', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => ok({ announcements: [{ id: 'a', title: 'Hi' }, { id: 'b', title: 'Yo' }] }));
    const onAnnouncements = vi.fn();
    const c = createCommunity({ settings: fakeSettings(), log: silentLog, appVersion: '1', fetchImpl, onAnnouncements });
    c.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(c.announcements().map((a) => a.id)).toEqual(['a', 'b']);
    c.dismiss('a');
    expect(c.announcements().map((a) => a.id)).toEqual(['b']);
    expect(onAnnouncements).toHaveBeenLastCalledWith([{ id: 'b', title: 'Yo' }]);
    c.stop();
    vi.useRealTimers();
  });
});
