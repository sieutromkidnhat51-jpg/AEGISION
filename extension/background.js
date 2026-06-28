// IrisAdapt Pro - Background Service Worker
// Điều phối giữa offscreen document, content scripts và popup

let currentBlurLevel = 0;

const DEFAULT_SETTINGS = {
  maxBlur: 15,
  notificationsEnabled: true,
  notificationCooldown: 30,
  sensitivity: 50
};

// ========== OFFSCREEN DOCUMENT ==========

async function setupOffscreen() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts.length > 0) return true;

    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Truy cập webcam để phát hiện khoảng cách khuôn mặt bảo vệ mắt'
    });
    return true;
  } catch (e) {
    console.error('Lỗi tạo offscreen document:', e);
    return false;
  }
}

async function removeOffscreen() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts.length > 0) {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {
    console.error('Lỗi xóa offscreen document:', e);
  }
}

// ========== GỬI BLUR ĐẾN TẤT CẢ TAB ==========

async function broadcastBlur(level) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          await chrome.tabs.sendMessage(tab.id, { type: 'SET_BLUR', level });
        }
      } catch (e) {
        // Tab chưa load content script
      }
    }
  } catch (e) {
    console.error('Lỗi broadcast blur:', e);
  }
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
    case 'START_TRACKING':
      handleStartTracking(message.settings, sendResponse);
      return true;

    case 'STOP_TRACKING':
      handleStopTracking(sendResponse);
      return true;

    case 'BLUR_UPDATE':
      handleBlurUpdate(message.level);
      break;

    case 'NOTIFY_TOO_CLOSE':
      showNotification(
        '⚠️ IrisAdapt Pro - Cảnh báo khoảng cách',
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
        try {
          chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: message.settings });
        } catch (e) {}
        sendResponse({ success: true });
      });
      return true;

    case 'DETECTION_ERROR':
      chrome.storage.local.set({ isTracking: false, currentBlur: 0 });
      broadcastBlur(0);
      break;
  }
});

async function handleStartTracking(settings, sendResponse) {
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  chrome.storage.local.set({ isTracking: true, settings: mergedSettings });

  const success = await setupOffscreen();
  if (success) {
    setTimeout(() => {
      try {
        chrome.runtime.sendMessage({
          type: 'BEGIN_DETECTION',
          settings: mergedSettings
        });
      } catch (e) {}
    }, 800);
    sendResponse({ success: true });
  } else {
    chrome.storage.local.set({ isTracking: false });
    sendResponse({ success: false, error: 'Không thể khởi tạo camera' });
  }
}

async function handleStopTracking(sendResponse) {
  chrome.storage.local.set({ isTracking: false, currentBlur: 0 });
  currentBlurLevel = 0;
  broadcastBlur(0);

  try {
    chrome.runtime.sendMessage({ type: 'STOP_DETECTION' });
  } catch (e) {}

  await removeOffscreen();
  sendResponse({ success: true });
}

function handleBlurUpdate(level) {
  const rounded = Math.round(level * 10) / 10;
  if (Math.abs(rounded - currentBlurLevel) >= 0.3) {
    currentBlurLevel = rounded;
    chrome.storage.local.set({ currentBlur: currentBlurLevel });
    broadcastBlur(currentBlurLevel);
  }
}

// ========== KHI CÀI ĐẶT EXTENSION ==========

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isTracking: false,
    currentBlur: 0,
    settings: DEFAULT_SETTINGS
  });
});
