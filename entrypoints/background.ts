// Background Service Worker — handles R4 Badge + R1 Alarms
// IMPORTANT: chrome.alarms.onAlarm listener MUST be registered at top level (not async)

import { storage } from '#imports';
import {
  SALE_ALARM_MINUTES,
  createSaleAlarmStatusSnapshot,
  getNextSaleTime,
  saleTimeStore,
} from '../lib/settings/sale-time';
import { recognizeChars as recognizeCharsTrOCR } from '../lib/vision/ocr-transformers';
import { solveCaptcha, solveCaptchaFromUrl } from '../lib/ppocr/inference';

const BATCH_PREVIEW_KEY = 'local:batchPreview';
const AUTH_HEADERS_KEY = 'local:authHeaders';
const NEXT_SALE_TIME_KEY = 'local:nextSaleTime';

interface AuthHeaders {
  authorization: string;
  bigmodelOrganization: string;
  bigmodelProject: string;
}

const BADGE_STYLES: Record<number, { text: string; color: string; desc: string }> = {
  60: { text: '60', color: '#0ea5e9', desc: '距秒杀 60 分钟' },
  30: { text: '30', color: '#6366f1', desc: '距秒杀 30 分钟' },
  15: { text: '15', color: '#f59e0b', desc: '距秒杀 15 分钟' },
   5: { text: '5!', color: '#dc2626', desc: '距秒杀 5 分钟：立即录入验证码！' },
};

async function showFlashNotification(min: number) {
  const message = min >= 60
    ? `距秒杀开始还有 ${Math.floor(min / 60)} 小时${min % 60 ? min % 60 + ' 分钟' : ''}，数据已刷新`
    : min <= 5
      ? '距秒杀开始还有 5 分钟！请尽快录入验证码，越多越好。'
      : `距秒杀开始还有 ${min} 分钟！`;
  const title = min <= 5 ? '🔥 智谱秒杀提醒 · 验证码冲刺' : '🔥 智谱秒杀提醒';

  try {
    await chrome.notifications.create(`flash-${min}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 2,
      buttons: [
        { title: '立即准备' },
        { title: '稍后提醒' },
      ],
    });
  } catch {
    // Fallback to a smaller icon + no buttons if the platform rejects image/button payload.
    await chrome.notifications.create(`flash-${min}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon16.png'),
      title,
      message,
      priority: 2,
    }).catch(() => undefined);
  }
}

async function fetchAndCacheBatchPreview(): Promise<boolean> {
  try {
    const auth = await storage.getItem<AuthHeaders>(AUTH_HEADERS_KEY);
    if (!auth?.authorization || !auth?.bigmodelOrganization || !auth?.bigmodelProject) {
      return false;
    }

    const res = await fetch('https://bigmodel.cn/api/biz/pay/batch-preview', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        authorization: auth.authorization,
        'bigmodel-organization': auth.bigmodelOrganization,
        'bigmodel-project': auth.bigmodelProject,
      },
      body: '{"invitationCode":""}',
    });
    const data = await res.json();
    if (data.code === 200 && data.data?.productList) {
      await storage.setItem(BATCH_PREVIEW_KEY, data);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function rescheduleSaleAlarms(reason = 'runtime') {
  const config = await saleTimeStore.get();
  const snapshot = createSaleAlarmStatusSnapshot(config, Date.now(), reason);

  await Promise.all(
    SALE_ALARM_MINUTES.map((minutesBefore) => chrome.alarms.clear(`flash-${minutesBefore}`)),
  );

  snapshot.items.forEach((item) => {
    if (item.status === 'pending') {
      chrome.alarms.create(item.name, { when: item.notificationTime });
    }
  });

  await storage.setItem(NEXT_SALE_TIME_KEY, snapshot.nextSaleTime);
  await saleTimeStore.setAlarmStatus(snapshot);
  return snapshot;
}

export default defineBackground(() => {
  let badgeTimeoutIds: ReturnType<typeof setTimeout>[] = [];
  let badgeFlashIntervalId: ReturnType<typeof setInterval> | null = null;

  function clearBadgeAlerts() {
    badgeTimeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
    badgeTimeoutIds = [];
    if (badgeFlashIntervalId) {
      clearInterval(badgeFlashIntervalId);
      badgeFlashIntervalId = null;
    }
    chrome.action.setBadgeText({ text: '' });
  }

  // R1: chrome.alarms — TOP LEVEL registration (not inside async function!)
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith('flash-')) return;
    const min = parseInt(alarm.name.split('-')[1], 10);
    if (isNaN(min)) return;

    // Every alarm point: refresh batch preview data
    await fetchAndCacheBatchPreview();

    // Show notification at every alarm point.
    await showFlashNotification(min);
  });

  // R4: Badge update + flash animation
  async function scheduleBadgeAlerts() {
    clearBadgeAlerts();
    const config = await saleTimeStore.get();
    const saleTime = getNextSaleTime(config);
    const now = Date.now();

    [60, 30, 15, 5].forEach((min) => {
      const alertTime = saleTime - min * 60 * 1000;
      if (alertTime <= now) return;

      const delay = alertTime - now;
      const timeoutId = setTimeout(() => {
        const style = BADGE_STYLES[min];
        if (!style) return;

        chrome.action.setBadgeText({ text: style.text });
        chrome.action.setBadgeBackgroundColor({ color: style.color });
        chrome.action.setTitle({ title: style.desc });

        if (min === 5) {
          // Flash badge every 500 ms until sale time
          let flash = true;
          const intervalId = setInterval(() => {
            chrome.action.setBadgeText({ text: flash ? '5!' : '' });
            flash = !flash;
          }, 500);
          badgeFlashIntervalId = intervalId;
          const remaining = saleTime - Date.now();
          if (remaining > 0) {
            const endTimeoutId = setTimeout(() => {
              clearInterval(intervalId);
              badgeFlashIntervalId = null;
              chrome.action.setBadgeText({ text: '🔥' });
              chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
              chrome.action.setTitle({ title: '秒杀进行中！' });
            }, remaining);
            badgeTimeoutIds.push(endTimeoutId);
          }
        }
      }, delay);
      badgeTimeoutIds.push(timeoutId);
    });
  }

  // On extension install: schedule both
  chrome.runtime.onInstalled.addListener(() => {
    rescheduleSaleAlarms('installed');
    scheduleBadgeAlerts();
    fetchAndCacheBatchPreview();
  });

  // On Chrome startup: re-schedule (alarms don't persist across restart)
  chrome.runtime.onStartup.addListener(() => {
    rescheduleSaleAlarms('startup');
    scheduleBadgeAlerts();
    fetchAndCacheBatchPreview();
  });

  // Listen for sale time config updates from Options page
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SALE_TIME_UPDATED') {
      saleTimeStore.set(msg.config)
        .then(() => rescheduleSaleAlarms('manual-confirm'))
        .then((alarmStatus) => {
          scheduleBadgeAlerts();
          fetchAndCacheBatchPreview();
          sendResponse({ ok: true, alarmStatus });
        });
      return true;
    }
    if (msg.type === 'SOLVE_CAPTCHA_REQUEST') {
      handleSolveRequest(msg, sender).then(sendResponse).catch((e) => {
        console.error('[bg] handleSolveRequest error:', e);
        sendResponse({ error: e.message || String(e) });
      });
      return true;
    }
    if (msg.type === 'SOLVE_CAPTCHA_DIRECT_URL_REQUEST') {
      handleSolveDirectUrlRequest(msg).then(sendResponse).catch((e) => {
        console.error('[bg] handleSolveDirectUrlRequest error:', e);
        sendResponse({ error: e.message || String(e) });
      });
      return true;
    }
  });

  async function captureTabWithDebugger(tabId: number, clip?: { x: number; y: number; width: number; height: number; scale: number }): Promise<string> {
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const params: any = { format: 'png' };
        if (clip) params.clip = clip;
        chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', params, (result) => {
          chrome.debugger.detach({ tabId });
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(`data:image/png;base64,${result.data}`);
        });
      });
    });
  }

  async function handleSolveRequest(msg: any, sender: chrome.runtime.MessageSender) {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    console.log('[bg] SOLVE_CAPTCHA_REQUEST from tab', tabId, 'window', windowId, 'dpr', msg.dpr);
    if (!tabId || !windowId) return { error: 'No tab/window' };
    if (!msg.iframeRect || !msg.promptChars) return { error: 'Missing params' };

    const dpr = msg.dpr || 1;
    const promptChars = msg.promptChars as string[];
    const rect = msg.iframeRect;

    // Capture only the captcha region via debugger clip (no full-page screenshot)
    const dataUrl = await captureTabWithDebugger(tabId, {
      x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: dpr,
    });
    const captchaBlob = await (await fetch(dataUrl)).blob();

    const points = await solveCaptcha(captchaBlob, promptChars);
    if (!points.length) return { error: 'No points returned from server' };

    // Map normalized coords to page coords
    const ox = msg.iframeRect.x;
    const oy = msg.iframeRect.y;
    const pagePoints = points.map(p => ({
      char: p.char,
      pageX: Math.round(ox + p.nx * msg.iframeRect.w),
      pageY: Math.round(oy + p.ny * msg.iframeRect.h),
    }));

    console.log('[bg] solved', pagePoints.length, 'points via PP-OCR YOLO');
    return { type: 'SOLVE_CAPTCHA_RESULT', points: pagePoints };
  }

  async function handleSolveDirectUrlRequest(msg: any) {
    const imageUrl = msg.imageUrl as string;
    const promptChars = msg.promptChars as string[];
    const iframeRect = msg.iframeRect as { x: number; y: number; w: number; h: number } | undefined;
    console.log('[bg] SOLVE_CAPTCHA_DIRECT_URL_REQUEST url=' + (imageUrl || '').slice(0, 80));
    if (!imageUrl || !promptChars?.length) return { error: 'Missing params' };

    const points = await solveCaptchaFromUrl(imageUrl, promptChars);
    if (!points.length) return { error: 'No points returned from server' };

    // Map normalized coords to page coords if rect available
    if (iframeRect) {
      const pagePoints = points.map(p => ({
        char: p.char,
        pageX: Math.round(iframeRect.x + p.nx * iframeRect.w),
        pageY: Math.round(iframeRect.y + p.ny * iframeRect.h),
      }));
      console.log('[bg] direct-url solved', pagePoints.length, 'points');
      return { type: 'SOLVE_CAPTCHA_RESULT', points: pagePoints };
    }

    console.log('[bg] direct-url solved', points.length, 'points (normalized)');
    return { points };
  }

  // R1: Handle notification button clicks
  chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
    if (!notifId.startsWith('flash-')) return;
    if (btnIdx === 0) {
      chrome.action.openPopup().catch(() => {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
      });
    }
    chrome.notifications.clear(notifId);
  });

  chrome.notifications.onClicked.addListener((notifId) => {
    if (!notifId.startsWith('flash-')) return;
    chrome.action.openPopup().catch(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    });
    chrome.notifications.clear(notifId);
  });
});