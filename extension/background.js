// IrisAdapt Pro - Background Service Worker

let currentBlurLevel = 0;
let trackerWindowId = null;

const DEFAULT_SETTINGS = {
  maxBlur: 15,
  notificationsEnabled: true,
  notificationCooldown: 30,
  sensitivity: 50
};

// ========== TRACKER WINDOW ==========

async function openTrackerWindow() {
  // Đóng window cũ nếu còn
  if (trackerWindowId !== null) {
    try {
      await chrome.windows.remove(trackerWindowId);
    } catch (e) {}
    trackerWindowId = null;
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('tracker.html'),
    type: 'popup',
    width: 380,
    height: 340,
    top: 50,
    left: 50
  });
  trackerWindowId = win.id;
}

async function closeTrackerWindow() {
  if (trackerWindowId !== null) {
    try {
      await chrome.windows.remove(trackerWindowId);
    } catch (e) {}
    trackerWindowId = null;
  }
}

// Theo dõi khi user đóng tracker window
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === trackerWindowId) {
    trackerWindowId = null;
    chrome.storage.local.set({ isTracking: false, currentBlur: 0 });
    currentBlurLevel = 0;
    broadcastBlur(0);
  }
});

// ========== GỬI BLUR ĐẾN TẤT CẢ TAB ==========

async function broadcastBlur(level) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        if (tab.id && tab.url &&
            !tab.url.startsWith('chrome://') &&
            !tab.url.startsWith('chrome-extension://')) {
          chrome.tabs.sendMessage(tab.id, { type: 'SET_BLUR', level }).catch(() => {});
        }
      } catch (e) {}
    }
  } catch (e) {}
}

// ========== THÔNG BÁO ==========

let lastNotificationTime = 0;

function showNotification(title, message) {
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || DEFAULT_SETTINGS;
    const cooldown = (settings.notificationCooldown || 30) * 1000;
    const now = Date.now();

    if (!settings.notificationsEnabled) return;
    if (now - lastNotificationTime < cooldown) return;

    lastNotificationTime = now;

    chrome.notifications.create(`irisadapt-${now}`, {
      type: 'basic',
      iconUrl: 'icon.png',
      title: title,
      message: message,
      priority: 2
    });
  });
}

// ========== XỬ LÝ TIN NHẮN ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_TRACKING': {
      const mergedSettings = { ...DEFAULT_SETTINGS, ...message.settings };
      chrome.storage.local.set({ isTracking: true, settings: mergedSettings });
      openTrackerWindow().then(() => {
        sendResponse({ success: true });
      }).catch((e) => {
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    case 'STOP_TRACKING': {
      chrome.storage.local.set({ isTracking: false, currentBlur: 0 });
      currentBlurLevel = 0;
      broadcastBlur(0);
      closeTrackerWindow().then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    case 'BLUR_UPDATE': {
      const rounded = Math.round(message.level * 10) / 10;
      if (Math.abs(rounded - currentBlurLevel) >= 0.3) {
        currentBlurLevel = rounded;
        chrome.storage.local.set({ currentBlur: currentBlurLevel });
        broadcastBlur(currentBlurLevel);
      }
      break;
    }

    case 'NOTIFY_TOO_CLOSE':
      showNotification(
        '⚠️ IrisAdapt Pro - Cảnh báo',
        'Bạn đang ngồi quá gần màn hình! Hãy lùi lại khoảng 50-70cm để bảo vệ mắt.'
      );
      break;

    case 'GET_STATUS':
      chrome.storage.local.get(['isTracking', 'settings', 'currentBlur'], (result) => {
        sendResponse({
          isTracking: result.isTracking || false,
          settings: result.settings || DEFAULT_SETTINGS,
          currentBlur: result.currentBlur || 0
        });
      });
      return true;

    case 'SAVE_SETTINGS':
      chrome.storage.local.set({ settings: message.settings }, () => {
        sendResponse({ success: true });
      });
      return true;
  }
});

// ========== KHI CÀI ĐẶT ==========

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isTracking: false,
    currentBlur: 0,
    settings: DEFAULT_SETTINGS
  });
});
