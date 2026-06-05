import { describe, it, expect } from 'vitest';
import { getHubConfig, setHubConfig, isHubReady, HUB_CONFIG_DEFAULT } from '../../../../lib/api/hub-config';

describe('hub-config', () => {
  describe('default values', () => {
    it('returns default config when nothing stored', async () => {
      const cfg = await getHubConfig();
      expect(cfg).toEqual(HUB_CONFIG_DEFAULT);
      expect(cfg.enabled).toBe(false);
      expect(cfg.fireIntervalMs).toBe(1850);
    });

    it('isHubReady returns false by default', async () => {
      expect(await isHubReady()).toBe(false);
    });
  });

  describe('set/get round-trip', () => {
    it('stores and retrieves enabled config', async () => {
      await setHubConfig({ enabled: true, fireIntervalMs: 2000 });
      const cfg = await getHubConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.fireIntervalMs).toBe(2000);
    });

    it('isHubReady returns true when enabled', async () => {
      await setHubConfig({ enabled: true, fireIntervalMs: 1850 });
      expect(await isHubReady()).toBe(true);
    });
  });

  describe('partial update', () => {
    it('overwrites entire config on set', async () => {
      await setHubConfig({ enabled: true, fireIntervalMs: 2000 });
      await setHubConfig({ enabled: false, fireIntervalMs: 2000 });

      const cfg = await getHubConfig();
      expect(cfg.enabled).toBe(false);
    });
  });
});
