// chrome-auto-signin/background.js

/**
 * 配置区域 - 根据你的需求修改
 */
const CONFIG = {
    // 基本设置
    signInUrl: 'https://www.iamtxt.com',
    signInButtonSelector: '.signin', // This is primarily for content.js, but kept here for consistency if needed.

    // 签到成功的标识 (Content script will handle this)
    successIndicator: {
        type: 'text',
        value: ['今天已经签过了哈', '阅读愉快']
    },

    // 时间设置
    checkInterval: 24, // 签到频率（小时）
    autoCheckInterval: 60, // 自动检查间隔（分钟）
    autoCloseDelay: 3000, // 自动关闭前等待时间（毫秒）

    // 功能开关
    checkOnAnyWebsite: true, // 是否在任何网站上检查签到状态 (Background script handles this)
    autoCloseAfterSuccess: false, // 是否在签到后自动关闭页面 (Background script handles closing)
    showNotification: true, // 是否显示通知 (Background script handles notifications)

    // 调试选项 (Background script will respect debugMode for its logs, content.js for its logs and panel)
    debugMode: false,
    debug: {
        skipTimeCheck: false,
        verbose: true,
        simulateClick: false // Content script handles this
    }
};

/**
 * 调试日志函数，仅在调试模式和详细模式下输出日志。
 * @param {...any} args - 要输出的日志内容。
 */
const debugLog = (...args) => {
    if (CONFIG.debugMode && CONFIG.debug.verbose) {
        console.log('%c[自动签到后台调试]', 'color: #FFD700; font-weight: bold;', ...args);
    }
};

/**
 * 格式化时间戳为本地时间字符串。
 * @param {number} timestamp - 时间戳（毫秒）。
 * @returns {string} 格式化后的时间字符串。
 */
const formatTime = (timestamp) => {
    return timestamp ? new Date(timestamp).toLocaleString() : 'N/A';
};

/**
 * 计算两个时间戳之间的分钟差。
 * @param {number} time1 - 第一个时间戳（毫秒）。
 * @param {number} time2 - 第二个时间戳（毫秒）。
 * @returns {number} 分钟差。
 */
const getTimeDiffInMinutes = (time1, time2) => {
    return Math.floor((time1 - time2) / 60000);
};

/**
 * 显示通知。
 * @param {string} title - 通知标题。
 * @param {string} message - 通知内容。
 */
const showNotification = (title, message) => {
    if (CONFIG.showNotification) {
        debugLog('显示通知:', title, message);
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: title,
            message: message,
            priority: 2
        });
    }
};

/**
 * 获取存储中的值。
 * @param {string} key - 键名。
 * @param {any} defaultValue - 默认值。
 * @returns {Promise<any>} 存储的值或默认值。
 */
const getStorageValue = async (key, defaultValue) => {
    const result = await chrome.storage.local.get(key);
    return result[key] !== undefined ? result[key] : defaultValue;
};

/**
 * 设置存储中的值。
 * @param {string} key - 键名。
 * @param {any} value - 值。
 * @returns {Promise<void>}
 */
const setStorageValue = async (key, value) => {
    await chrome.storage.local.set({ [key]: value });
};

/**
 * 打开签到页面。
 */
const openSignInPage = async () => {
    debugLog('打开签到页面...');
    try {
        // Check if the sign-in page is already open
        const tabs = await chrome.tabs.query({ url: `${CONFIG.signInUrl}*` });
        if (tabs.length > 0) {
            debugLog('签到页面已打开，激活现有标签页:', tabs[0].url);
            await chrome.tabs.update(tabs[0].id, { active: true });
            // Send a message to the content script in that tab to trigger sign-in if needed
            // This is a bit complex, for now, let's just open a new one if not already active.
            // Or, if it's already active, assume content script will handle it.
            // For simplicity, if it's already open, we just activate it.
            // If the user closes it, the alarm will open it again.
            return;
        }

        await chrome.tabs.create({ url: CONFIG.signInUrl, active: true });
        debugLog('已请求打开签到页面');
    } catch (error) {
        debugLog('打开签到页面失败:', error.message);
        showNotification('签到失败', '无法打开签到页面');
    }
};

/**
 * 检查是否需要执行签到操作。
 * @returns {Promise<boolean>}
 */
const checkNeedToSign = async () => {
    const currentTime = new Date().getTime();
    const lastSignTime = await getStorageValue('lastSignTime', 0);
    const need = CONFIG.debug.skipTimeCheck ||
                 (currentTime - lastSignTime) > (CONFIG.checkInterval * 60 * 60 * 1000);
    debugLog('上次签到时间:', formatTime(lastSignTime));
    debugLog('当前时间:', formatTime(currentTime));
    debugLog('是否需要签到:', need);
    return need;
};

/**
 * 执行自动检查逻辑。
 */
const performAutoCheck = async () => {
    const currentTime = new Date().getTime();
    const lastCheckTime = await getStorageValue('lastCheckTime', 0);
    const checkIntervalMs = CONFIG.autoCheckInterval * 60 * 1000;
    const timeSinceLastCheck = currentTime - lastCheckTime;

    debugLog('执行自动检查...');
    debugLog('距离上次检查时间:', getTimeDiffInMinutes(currentTime, lastCheckTime), '分钟');
    debugLog('检查间隔设置为:', CONFIG.autoCheckInterval, '分钟');

    if (timeSinceLastCheck > checkIntervalMs) {
        debugLog('达到检查间隔，更新上次检查时间并检查是否需要签到');
        await setStorageValue('lastCheckTime', currentTime);

        const needToSign = await checkNeedToSign();
        if (needToSign) {
            debugLog('自动检查发现需要签到，准备打开签到页面');
            showNotification('自动签到', '检测到需要签到，正在打开签到页面...');
            await openSignInPage();
        } else {
            debugLog('自动检查发现不需要签到');
        }
    } else {
        debugLog('距离上次检查时间未超过设定间隔，跳过检查');
    }
};

/**
 * 初始化报警器。
 */
const setupAlarm = async () => {
    // Clear existing alarms to prevent duplicates
    await chrome.alarms.clear('autoSignInCheck');

    // Set up a new alarm
    chrome.alarms.create('autoSignInCheck', {
        delayInMinutes: 1, // Start after 1 minute
        periodInMinutes: CONFIG.autoCheckInterval // Repeat every CONFIG.autoCheckInterval minutes
    });
    debugLog(`已设置自动检查报警器，每 ${CONFIG.autoCheckInterval} 分钟触发一次`);
};

// 监听报警器事件
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'autoSignInCheck') {
        debugLog('报警器触发: autoSignInCheck');
        if (CONFIG.checkOnAnyWebsite) {
            performAutoCheck();
        } else {
            debugLog('未启用在任何网站上检查，跳过自动检查');
        }
    }
});

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    debugLog('收到来自内容脚本的消息:', request);

    if (request.action === 'get_config') {
        sendResponse({ config: CONFIG });
    } else if (request.action === 'get_storage_values') {
        const lastSignTime = await getStorageValue('lastSignTime', 0);
        const lastCheckTime = await getStorageValue('lastCheckTime', 0);
        sendResponse({ lastSignTime, lastCheckTime });
    } else if (request.action === 'set_storage_value') {
        await setStorageValue(request.key, request.value);
        sendResponse({ success: true });
    } else if (request.action === 'show_notification') {
        showNotification(request.title, request.message);
        sendResponse({ success: true });
    } else if (request.action === 'sign_in_success') {
        await setStorageValue('lastSignTime', new Date().getTime());
        showNotification('签到成功', '已完成今日签到');
        if (CONFIG.autoCloseAfterSuccess && sender.tab && sender.tab.id) {
            debugLog(`将在 ${CONFIG.autoCloseDelay}ms 后关闭页面:`, sender.tab.url);
            setTimeout(() => {
                chrome.tabs.remove(sender.tab.id);
                debugLog('已关闭签到页面');
            }, CONFIG.autoCloseDelay);
        }
        sendResponse({ success: true });
    } else if (request.action === 'force_sign_in') {
        const need = await checkNeedToSign();
        if (need) {
            await openSignInPage();
            sendResponse({ success: true, message: '已尝试打开签到页面' });
        } else {
            sendResponse({ success: false, message: '当前不需要签到' });
        }
    } else if (request.action === 'reset_sign_time') {
        await setStorageValue('lastSignTime', 0);
        sendResponse({ success: true });
    }
    // Return true to indicate that sendResponse will be called asynchronously
    return true;
});

// 首次安装或更新时设置报警器
chrome.runtime.onInstalled.addListener(() => {
    debugLog('扩展已安装或更新，设置报警器...');
    setupAlarm();
    // Perform an initial check immediately after install/update
    performAutoCheck();
});

// 启动时（例如浏览器启动）设置报警器
chrome.runtime.onStartup.addListener(() => {
    debugLog('浏览器启动，设置报警器...');
    setupAlarm();
    // Perform an initial check immediately on startup
    performAutoCheck();
});

// Initial setup when service worker starts
debugLog('后台服务工作者已启动');
setupAlarm();
performAutoCheck(); // Perform an initial check on service worker startup
