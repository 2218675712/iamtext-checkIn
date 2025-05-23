// chrome-auto-signin/content.js

(async function() {
    'use strict';

    /**
     * 配置区域 - 根据你的需求修改
     * 注意：此处的配置应与 background.js 中的配置保持一致，特别是 signInUrl, successIndicator, debugMode 等。
     * 某些配置（如 checkInterval, autoCheckInterval）仅在 background.js 中使用。
     */
    const CONFIG = {
        signInUrl: 'https://www.iamtxt.com', // Must match manifest.json and background.js
        signInButtonSelector: '.signin',

        successIndicator: {
            type: 'text',
            value: ['今天已经签过了哈', '阅读愉快']
        },

        autoCloseDelay: 3000, // 自动关闭前等待时间（毫秒） - Content script sends message to background to close
        autoCloseAfterSuccess: false, // 是否在签到后自动关闭页面 - Content script sends message to background to close
        showNotification: true, // 是否显示通知 - Content script sends message to background to show notification

        debugMode: false, // 是否启用调试模式
        debug: {
            skipTimeCheck: false, // 是否跳过时间检查，强制执行签到逻辑。 (Primarily for background, but affects debug panel display)
            verbose: true, // 是否显示详细的调试日志。
            simulateClick: false // 是否模拟点击签到按钮，而不实际执行点击操作。
        }
    };

    // Fetch initial config and storage values from background script
    let lastSignTime = 0;
    let lastCheckTime = 0;
    let needToSign = false; // This will be determined by background script, but for debug panel, we can re-evaluate.

    try {
        const responseConfig = await chrome.runtime.sendMessage({ action: 'get_config' });
        if (responseConfig && responseConfig.config) {
            // Merge relevant config from background, especially debugMode
            CONFIG.debugMode = responseConfig.config.debugMode;
            CONFIG.debug.skipTimeCheck = responseConfig.config.debug.skipTimeCheck;
            CONFIG.debug.verbose = responseConfig.config.debug.verbose;
            CONFIG.debug.simulateClick = responseConfig.config.debug.simulateClick;
            CONFIG.autoCloseAfterSuccess = responseConfig.config.autoCloseAfterSuccess;
            CONFIG.autoCloseDelay = responseConfig.config.autoCloseDelay;
            CONFIG.showNotification = responseConfig.config.showNotification;
        }

        const responseStorage = await chrome.runtime.sendMessage({ action: 'get_storage_values' });
        if (responseStorage) {
            lastSignTime = responseStorage.lastSignTime || 0;
            lastCheckTime = responseStorage.lastCheckTime || 0;
            // Re-evaluate needToSign based on fetched lastSignTime and current time
            const currentTime = new Date().getTime();
            const checkIntervalHours = responseConfig.config.checkInterval || 24; // Get from background config
            needToSign = CONFIG.debug.skipTimeCheck ||
                         (currentTime - lastSignTime) > (checkIntervalHours * 60 * 60 * 1000);
        }
    } catch (error) {
        console.error('[自动签到内容脚本] 获取配置或存储失败:', error);
        // Fallback to default CONFIG values if communication fails
    }


    /**
     * 工具函数
     */
    /**
     * 调试日志函数，仅在调试模式和详细模式下输出日志。
     * @param {...any} args - 要输出的日志内容。
     */
    const debugLog = (...args) => {
        if (CONFIG.debugMode && CONFIG.debug.verbose) {
            console.log('%c[自动签到内容脚本调试]', 'color: #4CAF50; font-weight: bold;', ...args);
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
     * 显示通知（通过后台脚本）。
     * @param {string} title - 通知标题。
     * @param {string} text - 通知内容。
     */
    const showNotification = (title, text) => {
        if (CONFIG.showNotification) {
            debugLog('请求显示通知:', title, text);
            chrome.runtime.sendMessage({ action: 'show_notification', title: title, message: text });
        }
    };

    /**
     * 安全地执行 DOM 查询，捕获潜在错误。
     * @param {string} selector - CSS 选择器。
     * @returns {Element|null} 找到的元素或 null。
     */
    const safeQuerySelector = (selector) => {
        try {
            return document.querySelector(selector);
        } catch (error) {
            debugLog('选择器查询错误:', error.message, selector);
            return null;
        }
    };

    /**
     * UI 辅助函数对象，用于创建和操作页面元素。
     */
    const UI = {
        /**
         * 创建一个 DOM 元素并设置属性和样式。
         * @param {string} tag - 元素标签名。
         * @param {object} [attributes={}] - 元素属性对象。
         * @param {object} [styles={}] - 元素样式对象。
         * @returns {Element} 创建的 DOM 元素。
         */
        createElement: (tag, attributes = {}, styles = {}) => {
            const element = document.createElement(tag);

            // 设置属性
            Object.entries(attributes).forEach(([key, value]) => {
                if (key === 'textContent') {
                    element.textContent = value;
                } else {
                    element.setAttribute(key, value);
                }
            });

            // 设置样式
            Object.entries(styles).forEach(([key, value]) => {
                element.style[key] = value;
            });

            return element;
        },

        /**
         * 在指定的容器中添加一个信息行（标签和值）。
         * @param {Element} container - 信息行要添加到的容器元素。
         * @param {string} label - 信息标签文本。
         * @param {string} value - 信息值文本。
         * @returns {Element} 值所在的 span 元素。
         */
        addInfoRow: (container, label, value) => {
            const row = UI.createElement('div', {}, { margin: '5px 0' });

            const labelSpan = UI.createElement('span',
                { textContent: `${label}: ` },
                { fontWeight: 'bold' }
            );

            const valueSpan = UI.createElement('span',
                { textContent: value }
            );

            row.appendChild(labelSpan);
            row.appendChild(valueSpan);
            container.appendChild(row);

            return valueSpan;
        },

        /**
         * 创建一个按钮元素。
         * @param {string} text - 按钮文本。
         * @param {function} onClick - 按钮点击事件处理函数。
         * @param {string} [color='#4CAF50'] - 按钮背景颜色。
         * @returns {HTMLButtonElement} 创建的按钮元素。
         */
        createButton: (text, onClick, color = '#4CAF50') => {
            const button = UI.createElement('button',
                { textContent: text },
                {
                    margin: '5px 5px 5px 0',
                    padding: '5px 10px',
                    backgroundColor: color,
                    border: 'none',
                    borderRadius: '3px',
                    color: 'white',
                    cursor: 'pointer'
                }
            );
            button.addEventListener('click', onClick);
            return button;
        },

        /**
         * 调试面板的 CSS 样式对象。
         */
        debugPanelStyles: {
            position: 'fixed',
            bottom: '10px',
            right: '10px',
            width: '300px',
            padding: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            borderRadius: '5px',
            zIndex: '9999',
            fontSize: '12px',
            maxHeight: '300px',
            overflowY: 'auto'
        }
    };

    /**
     * 核心功能函数
     */
    /**
     * 尝试在当前页面执行签到操作。
     * 查找签到按钮并模拟点击，然后等待并检查签到结果。
     */
    const tryToSignIn = () => {
        debugLog('尝试签到...');

        try {
            // 查找签到按钮
            const signInButton = safeQuerySelector(CONFIG.signInButtonSelector);

            // 输出页面上所有可能的按钮，帮助调试
            if (CONFIG.debugMode) {
                debugLog('页面上的所有按钮:');
                const buttonSelectors = 'button, input[type="button"], a.btn, .button, [role="button"]';
                const allButtons = document.querySelectorAll(buttonSelectors);

                Array.from(allButtons).forEach((btn, index) => {
                    const text = btn.innerText || btn.value || btn.textContent || '';
                    const classes = btn.className || '';
                    const id = btn.id || '';
                    debugLog(`按钮 ${index+1}:`, { text, classes, id, element: btn });
                });
            }

            if (signInButton) {
                debugLog('找到签到按钮:', signInButton);

                // 点击签到按钮
                if (!CONFIG.debug.simulateClick) {
                    signInButton.click();
                    debugLog('已点击签到按钮');
                } else {
                    debugLog('模拟点击签到按钮（未实际点击）');
                }

                // 等待并检查签到结果
                setTimeout(checkSignInResult, 2000);
            } else {
                debugLog('未找到签到按钮，可能选择器不正确或页面结构已变化');
                debugLog('当前使用的选择器:', CONFIG.signInButtonSelector);
                showNotification('签到失败', '未找到签到按钮，请检查脚本配置');
            }
        } catch (error) {
            debugLog('签到过程出错:', error.message);
        }
    };

    /**
     * 检查签到结果。
     * 根据配置的 successIndicator 类型（文本或元素）检查页面是否包含签到成功的标识。
     * 如果成功，更新最后签到时间并显示通知；如果配置了自动关闭，则延迟关闭页面。
     */
    const checkSignInResult = () => {
        debugLog('检查签到结果...');
        let success = false;

        try {
            if (CONFIG.successIndicator.type === 'text') {
                // 检查页面中是否包含任一成功文本
                const pageText = document.body.innerText || '';
                const successTexts = Array.isArray(CONFIG.successIndicator.value)
                    ? CONFIG.successIndicator.value
                    : [CONFIG.successIndicator.value];

                // 检查是否包含任一成功文本
                success = successTexts.some(text => pageText.includes(text));

                debugLog('检查成功文本:', successTexts.join(' 或 '));
                debugLog('页面文本包含成功文本:', success);

                if (success && CONFIG.debugMode) {
                    // 找出匹配的文本
                    const matchedText = successTexts.find(text => pageText.includes(text));
                    debugLog('匹配的成功文本:', matchedText);
                }

                if (CONFIG.debugMode) {
                    // 输出页面文本片段，帮助调试
                    const textSnippet = pageText.substring(0, 200) + '...';
                    debugLog('页面文本片段:', textSnippet);
                }
            } else if (CONFIG.successIndicator.type === 'element') {
                // 检查成功元素是否存在
                const successElement = safeQuerySelector(CONFIG.successIndicator.value);
                success = !!successElement;
                debugLog('检查成功元素:', CONFIG.successIndicator.value);
                debugLog('成功元素存在:', success);

                if (success && CONFIG.debugMode) {
                    debugLog('成功元素:', successElement);
                }
            }

            if (success) {
                debugLog('签到成功！');
                // 通知后台脚本签到成功，由后台脚本更新时间并处理关闭
                chrome.runtime.sendMessage({ action: 'sign_in_success' });
            } else {
                debugLog('签到可能失败，未检测到成功标识');
                showNotification('签到状态未知', '未检测到成功标识，请手动确认');
            }
        } catch (error) {
            debugLog('检查签到结果出错:', error.message);
        }
    };

    /**
     * 添加调试面板到页面。
     * 仅在调试模式启用时创建并添加调试面板，包含状态信息和手动操作按钮。
     * @returns {Element|null} 创建的调试面板元素或 null。
     */
    const addDebugPanel = async () => {
        if (!CONFIG.debugMode) return null;

        debugLog('添加调试面板');

        try {
            // 检查是否已存在调试面板
            const existingPanel = document.querySelector('[data-auto-signin-debug-panel]');
            if (existingPanel) {
                debugLog('调试面板已存在，不重复创建');
                return existingPanel;
            }

            // 创建调试面板
            const panel = UI.createElement('div',
                { 'data-auto-signin-debug-panel': 'true' },
                UI.debugPanelStyles
            );

            // 添加标题
            const title = UI.createElement('h3',
                { textContent: '自动签到调试面板' },
                { margin: '0 0 10px 0', color: '#4CAF50' }
            );
            panel.appendChild(title);

            // 获取最新的存储值以显示在面板上
            const storageValues = await chrome.runtime.sendMessage({ action: 'get_storage_values' });
            const currentLastSignTime = storageValues.lastSignTime || 0;
            const currentLastCheckTime = storageValues.lastCheckTime || 0;

            // Re-evaluate needToSign for display
            const backgroundConfig = await chrome.runtime.sendMessage({ action: 'get_config' });
            const checkIntervalHours = backgroundConfig.config.checkInterval || 24;
            const currentTime = new Date().getTime();
            const currentNeedToSign = CONFIG.debug.skipTimeCheck ||
                                     (currentTime - currentLastSignTime) > (checkIntervalHours * 60 * 60 * 1000);


            // 添加各种状态信息
            const lastSignTimeSpan = UI.addInfoRow(panel, '上次签到时间', formatTime(currentLastSignTime));
            const needToSignSpan = UI.addInfoRow(panel, '需要签到', currentNeedToSign.toString());
            UI.addInfoRow(panel, '在签到页面', 'true'); // Always true for content.js

            // 添加功能按钮
            const forceSignInButton = UI.createButton('强制签到', async () => {
                debugLog('手动触发签到');
                tryToSignIn();
            });
            panel.appendChild(forceSignInButton);

            const resetTimeButton = UI.createButton('重置签到时间', async () => {
                await chrome.runtime.sendMessage({ action: 'set_storage_value', key: 'lastSignTime', value: 0 });
                lastSignTimeSpan.textContent = formatTime(0);
                needToSignSpan.textContent = 'true';
                debugLog('已重置签到时间');
            });
            panel.appendChild(resetTimeButton);

            const findButtonsButton = UI.createButton('查找按钮', () => {
                const buttonSelectors = 'button, input[type="button"], a.btn, .button, [role="button"]';
                const allButtons = document.querySelectorAll(buttonSelectors);
                debugLog('页面上的所有按钮:', allButtons.length);

                Array.from(allButtons).forEach((btn, index) => {
                    btn.style.border = '2px solid red';
                    const text = btn.innerText || btn.value || btn.textContent || '';
                    debugLog(`按钮 ${index+1}:`, text, btn);
                });
            });
            panel.appendChild(findButtonsButton);

            // 添加自动检查功能相关信息和按钮
            const autoCheckTitle = UI.createElement('h4',
                { textContent: '自动检查功能' },
                { margin: '10px 0 5px 0', color: '#2196F3' }
            );
            panel.appendChild(autoCheckTitle);

            const backgroundConfigForAutoCheck = await chrome.runtime.sendMessage({ action: 'get_config' });
            const autoCheckEnabled = backgroundConfigForAutoCheck.config.checkOnAnyWebsite;
            const autoCheckIntervalMinutes = backgroundConfigForAutoCheck.config.autoCheckInterval;

            UI.addInfoRow(panel, '自动检查已启用', autoCheckEnabled.toString());
            UI.addInfoRow(panel, '检查间隔', autoCheckIntervalMinutes + ' 分钟');
            UI.addInfoRow(panel, '上次检查时间', formatTime(currentLastCheckTime));

            const nextCheckTime = currentLastCheckTime + (autoCheckIntervalMinutes * 60 * 1000);
            const nextCheckSpan = UI.addInfoRow(panel, '下次检查时间', formatTime(nextCheckTime));

            const checkNowButton = UI.createButton('立即检查', async () => {
                debugLog('手动触发检查 (通过后台)');
                const response = await chrome.runtime.sendMessage({ action: 'force_sign_in' });
                if (response.success) {
                    alert(response.message);
                } else {
                    alert(response.message);
                }
                // Update panel info after check
                const updatedStorage = await chrome.runtime.sendMessage({ action: 'get_storage_values' });
                const updatedLastCheckTime = updatedStorage.lastCheckTime || 0;
                const updatedNextCheckTime = updatedLastCheckTime + (autoCheckIntervalMinutes * 60 * 1000);
                nextCheckSpan.textContent = formatTime(updatedNextCheckTime);
            }, '#2196F3');
            panel.appendChild(checkNowButton);


            // 添加关闭按钮
            const closeButton = UI.createElement('span',
                { textContent: '×' },
                {
                    position: 'absolute',
                    top: '5px',
                    right: '10px',
                    cursor: 'pointer',
                    fontSize: '16px'
                }
            );
            closeButton.addEventListener('click', () => {
                panel.style.display = 'none';
            });
            panel.appendChild(closeButton);

            // 添加到页面
            document.body.appendChild(panel);

            return panel;
        } catch (error) {
            debugLog('创建调试面板出错:', error.message);
            return null;
        }
    };

    /**
     * 脚本主函数。
     * 在签到页面加载完成后执行签到操作，并根据配置决定是否添加调试面板。
     */
    const main = async () => {
        debugLog('内容脚本已加载');
        debugLog('当前页面:', window.location.href);
        debugLog('签到页面:', CONFIG.signInUrl);

        // 确保只在签到页面上执行签到操作
        if (window.location.href.startsWith(CONFIG.signInUrl)) {
            debugLog('当前在签到页面，准备执行签到操作');
            // 等待页面加载完成后执行签到
            setTimeout(tryToSignIn, 2000);

            // 如果在签到页面，添加调试面板
            if (CONFIG.debugMode) {
                // 等待页面加载完成后添加调试面板
                setTimeout(addDebugPanel, 1000);
            }
        } else {
            debugLog('当前不在签到页面，内容脚本不执行签到逻辑。');
        }
    };

    // 执行主函数
    main();
})();
