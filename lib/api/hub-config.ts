import { storage } from '#imports';

export interface HubConfig {
  enabled: boolean;
  fireIntervalMs: number;
}

const HUB_CONFIG_KEY = 'local:hubConfig';

export const HUB_CONFIG_DEFAULT: HubConfig = {
  enabled: false,
  fireIntervalMs: 1850,
};

export async function getHubConfig(): Promise<HubConfig> {
  return (await storage.getItem<HubConfig>(HUB_CONFIG_KEY)) ?? { ...HUB_CONFIG_DEFAULT };
}

export async function setHubConfig(config: HubConfig): Promise<void> {
  await storage.setItem(HUB_CONFIG_KEY, config);
}

export async function isHubReady(): Promise<boolean> {
  const cfg = await getHubConfig();
  return cfg.enabled;
}
