import { storage } from '#imports';

export interface ReplenishConfig {
  enabled: boolean;
  targetCount: number;
  leadTimeSec: number;
}

export const REPLENISH_CONFIG_DEFAULT: ReplenishConfig = {
  enabled: false,
  targetCount: 30,
  leadTimeSec: 300,
};

const STORAGE_KEY = 'local:replenishConfig';

export const replenishStore = {
  async get(): Promise<ReplenishConfig> {
    try {
      const stored = await storage.getItem<Partial<ReplenishConfig>>(STORAGE_KEY);
      return { ...REPLENISH_CONFIG_DEFAULT, ...(stored || {}) };
    } catch {
      return { ...REPLENISH_CONFIG_DEFAULT };
    }
  },

  async set(config: ReplenishConfig): Promise<void> {
    await storage.setItem(STORAGE_KEY, config);
  },
};
