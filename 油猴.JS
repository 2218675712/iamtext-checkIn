// ==UserScript==
// @name         iamtext自动网站签到脚本
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  每天自动进入指定网页进行签到（带调试功能和自动检查，避免重复打开标签页）
// @author       You
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        window.close
// @grant        GM_getTabs
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    /**
     * 配置区域 - 根据你的需求修改
     */
    /**
     * @typedef {object} SuccessIndicatorConfig
     * @property {'text'|'element'} type - 签到成功的标识类型，'text' 表示页面文本，'element' 表示页面元素。
     * @property {string|string[]} value - 如果 type 是 'text'，则为包含成功文本的字符串或字符串数组；如果 type 是 'element'，则为成功元素的 CSS 选择器。
     */

    /**
     * @typedef {object} DebugConfig
     * @property {boolean} skipTimeCheck - 是否跳过时间检查，强制执行签到逻辑。
     * @property {boolean} verbose - 是否显示详细的调试日志。
     * @property {boolean} simulateClick - 是否模拟点击签到按钮，而不实际执行点击操作。
     */

    /**
     * @typedef {object} ScriptConfig
     * @property {string} signInUrl - 需要签到的网站 URL。
     * @property {string} signInButtonSelector - 签到按钮的 CSS 选择器。
     * @property {SuccessIndicatorConfig} successIndicator - 签到成功的标识配置。
     * @property {number} checkInterval - 签到频率（小时）。
     * @property {number} autoCheckInterval - 自动检查间隔（分钟）。
     * @property {number} autoCloseDelay - 签到成功后自动关闭页面前等待的时间（毫秒）。
     * @property {boolean} checkOnAnyWebsite - 是否在任何网站上检查签到状态。
     * @property {boolean} autoCloseAfterSuccess - 是否在签到成功后自动关闭页面。
     * @property {boolean} showNotification - 是否显示通知。
     * @property {boolean} debugMode - 是否启用调试模式。
     * @property {DebugConfig} debug - 调试选项配置。
     */

    /**
     * 配置区域 - 根据你的需求修改
     * @type {ScriptConfig}
     */
    const CONFIG = {
        // 基本设置
        signInUrl: 'https://www.iamtxt.com',
        signInButtonSelector: '#signin', // 使用ID选择器更精确

        // 签到成功的标识
        successIndicator: {
            type: 'text', // 'text' 或 'element'
            value: ['今天已经签过了哈', '阅读愉快', '签到成功', '已签到'] // 增加更多可能的成功文本
        },

        // 时间设置
        checkInterval: 24, // 签到频率（小时）
        autoCheckInterval: 60, // 自动检查间隔（分钟）
        autoCloseDelay: 3000, // 自动关闭前等待时间（毫秒）

        // 功能开关
        checkOnAnyWebsite: true, // 是否在任何网站上检查签到状态
        autoCloseAfterSuccess: false, // 是否在签到后自动关闭页面
        showNotification: true, // 是否显示通知

        // 调试选项
        debugMode: false,
        debug: {
            skipTimeCheck: false, // 是否跳过时间检查
            verbose: true, // 是否显示详细日志
            simulateClick: false // 是否模拟点击
        }
    };

    /**
     * 工具函数
     */
    /**
     * 调试日志函数，仅在调试模式和详细模式下输出日志。
     * @param {...any} args - 要输出的日志内容。
     */
    const debugLog = (...args) => {
        if (CONFIG.debugMode && CONFIG.debug.verbose) {
            console.log('%c[自动签到调试]', 'color: #4CAF50; font-weight: bold;', ...args);
        }
    };

    /**
     * 格式化时间戳为本地时间字符串。
     * @param {number} timestamp - 时间戳（毫秒）。
     * @returns {string} 格式化后的时间字符串。
     */
    const formatTime = (timestamp) => {
        return new Date(timestamp).toLocaleString();
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
     * @param {string} text - 通知内容。
     */
    const showNotification = (title, text) => {
        debugLog('显示通知:', title, text);
        // 只在签到页面或调试模式下显示通知
        if (CONFIG.showNotification && (isSignInPage || (CONFIG.debugMode && title.includes('调试')))) {
            GM_notification({
                title: title,
                text: text,
                timeout: 5000
            });
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
     * 状态变量
     */
    /**
     * 当前时间戳（毫秒）。
     * @type {number}
     */
    const currentTime = new Date().getTime();
    /**
     * 上次成功签到的时间戳（毫秒），从 Tampermonkey 存储中获取，默认为 0。
     * @type {number}
     */
    const lastSignTime = GM_getValue('lastSignTime', 0);
    /**
     * 上次执行自动检查的时间戳（毫秒），从 Tampermonkey 存储中获取，默认为 0。
     * @type {number}
     */
    const lastCheckTime = GM_getValue('lastCheckTime', 0);

    /**
     * 判断当前页面是否是签到页面。
     * @type {boolean}
     */
    const isSignInPage = (() => {
        try {
            const currentUrl = window.location;
            const signInPageUrl = new URL(CONFIG.signInUrl);
            
            // 检查是否是登录页面，如果是则返回false
            if (currentUrl.pathname.includes('/e/member/login/')) {
                debugLog('当前是登录页面，不执行签到脚本');
                return false;
            }
            
            // 检查 hostname 和 pathname 是否完全匹配
            return currentUrl.hostname === signInPageUrl.hostname &&
                   currentUrl.pathname === signInPageUrl.pathname;
        } catch (error) {
            debugLog('URL解析或比较错误:', error.message);
            return false;
        }
    })();

    /**
     * 判断是否需要执行签到操作。
     * 如果启用了调试模式的 skipTimeCheck 选项，则始终为 true。
     * 否则，判断当前时间距离上次签到时间是否超过设定的签到间隔。
     * @type {boolean}
     */
    const needToSign = CONFIG.debug.skipTimeCheck ||
                       (currentTime - lastSignTime) > (CONFIG.checkInterval * 60 * 60 * 1000);

    /**
     * 核心功能函数
     */
    /**
     * 检查是否已经打开了 iamtxt 标签页。
     * @returns {Promise<boolean>} 如果已经打开返回 true，否则返回 false。
     */
    const checkIfIamtxtTabOpen = async () => {
        try {
            // 尝试获取所有打开的标签页
            // 注意：由于油猴脚本的安全限制，无法直接访问所有标签页
            // 这里采用一种间接的方式：尝试通过GM_getTab和GM_getTabs来检查
            const tabs = await new Promise((resolve) => {
                if (typeof GM_getTabs !== 'undefined') {
                    GM_getTabs((tabs) => {
                        resolve(tabs);
                    });
                } else {
                    // 如果不支持GM_getTabs，则假设标签页未打开
                    resolve({});
                }
            });

            // 检查是否有标签页已经打开了签到页面
            for (const tabId in tabs) {
                const tab = tabs[tabId];
                if (tab && tab.url && tab.url.includes(CONFIG.signInUrl)) {
                    debugLog('发现已打开的iamtxt标签页:', tab.url);
                    return true;
                }
            }

            return false;
        } catch (error) {
            debugLog('检查标签页状态时出错:', error.message);
            // 如果检查出错，默认返回false，允许打开新标签页
            return false;
        }
    };

    /**
     * 打开签到页面。
     * 使用 GM_openInTab 在新标签页中打开签到 URL。
     * 在打开前会检查是否已经打开了相同的标签页。
     */
    const openSignInPage = async () => {
        debugLog('准备打开签到页面...');
        
        try {
            // 检查是否已经打开了iamtxt标签页
            const isTabOpen = await checkIfIamtxtTabOpen();
            
            if (isTabOpen) {
                debugLog('iamtxt标签页已经打开，避免重复打开');
                return;
            }
            
            debugLog('打开签到页面...');
            GM_openInTab(CONFIG.signInUrl, { active: true, insert: true });
            debugLog('已请求打开签到页面');
        } catch (error) {
            debugLog('打开签到页面失败:', error.message);
        }
    };

    /**
     * 尝试在当前页面执行签到操作。
     * 查找签到按钮并模拟点击，然后等待并检查签到结果。
     */
    const tryToSignIn = () => {
        // 确保只在签到页面上执行签到操作
        if (!isSignInPage) {
            debugLog('当前不在签到页面，跳过签到操作');
            return;
        }

        debugLog('尝试签到...');

        try {
            // 查找签到按钮
            const signInButton = safeQuerySelector(CONFIG.signInButtonSelector);

            // 输出页面上所有可能的按钮，帮助调试
            if (CONFIG.debugMode) {
                debugLog('页面上的所有按钮:');
                // 更精确的按钮选择器，包括签到按钮相关的各种可能
                const buttonSelectors = 'button, input[type="button"], a.btn, .button, [role="button"], a.signin, a#signin, .signin, [id*="sign"], [class*="sign"]';
                const allButtons = document.querySelectorAll(buttonSelectors);

                Array.from(allButtons).forEach((btn, index) => {
                    const text = btn.innerText || btn.value || btn.textContent || '';
                    const classes = btn.className || '';
                    const id = btn.id || '';
                    const href = btn.href || '';
                    debugLog(`按钮 ${index+1}:`, { text, classes, id, href, element: btn });
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
        // 确保只在签到页面上检查签到结果
        if (!isSignInPage) {
            debugLog('当前不在签到页面，跳过检查签到结果');
            return;
        }

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
                // 更新最后签到时间
                GM_setValue('lastSignTime', currentTime);
                debugLog('已更新最后签到时间:', formatTime(currentTime));
                showNotification('签到成功', '已完成今日签到');

                // 如果配置为自动关闭，则延迟关闭页面
                if (CONFIG.autoCloseAfterSuccess) {
                    debugLog(`将在 ${CONFIG.autoCloseDelay}ms 后关闭页面`);
                    setTimeout(() => {
                        debugLog('关闭页面');
                        window.close();
                    }, CONFIG.autoCloseDelay);
                }
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
    const addDebugPanel = () => {
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

            // 添加各种状态信息
            const lastSignTimeSpan = UI.addInfoRow(panel, '上次签到时间', formatTime(lastSignTime));
            const needToSignSpan = UI.addInfoRow(panel, '需要签到', needToSign.toString());
            const isSignInPageSpan = UI.addInfoRow(panel, '在签到页面', isSignInPage.toString());

            // 添加功能按钮
            const forceSignInButton = UI.createButton('强制签到', () => {
                debugLog('手动触发签到');
                if (isSignInPage) {
                    tryToSignIn();
                } else {
                    debugLog('当前不在签到页面，无法执行签到操作');
                    alert('当前不在签到页面，请先访问签到网站再尝试手动签到');
                }
            });
            panel.appendChild(forceSignInButton);

            const resetTimeButton = UI.createButton('重置签到时间', () => {
                GM_setValue('lastSignTime', 0);
                lastSignTimeSpan.textContent = formatTime(0);
                needToSignSpan.textContent = 'true';
                debugLog('已重置签到时间');
            });
            panel.appendChild(resetTimeButton);

            const findButtonsButton = UI.createButton('查找按钮', () => {
                // 使用与调试功能相同的优化选择器
                const buttonSelectors = 'button, input[type="button"], a.btn, .button, [role="button"], a.signin, a#signin, .signin, [id*="sign"], [class*="sign"]';
                const allButtons = document.querySelectorAll(buttonSelectors);
                debugLog('页面上的所有按钮:', allButtons.length);

                Array.from(allButtons).forEach((btn, index) => {
                    btn.style.border = '2px solid red';
                    const text = btn.innerText || btn.value || btn.textContent || '';
                    const classes = btn.className || '';
                    const id = btn.id || '';
                    const href = btn.href || '';
                    debugLog(`按钮 ${index+1}:`, { text, classes, id, href, element: btn });
                });
            });
            panel.appendChild(findButtonsButton);

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
     * 更新调试面板，添加自动检查功能相关信息和按钮。
     * @param {Element} panel - 要更新的调试面板元素。
     */
    const updateDebugPanelWithAutoCheck = (panel) => {
        if (!panel) return;

        try {
            // 添加自动检查信息
            const autoCheckTitle = UI.createElement('h4',
                { textContent: '自动检查功能' },
                { margin: '10px 0 5px 0', color: '#2196F3' }
            );
            panel.appendChild(autoCheckTitle);

            UI.addInfoRow(panel, '自动检查已启用', CONFIG.checkOnAnyWebsite.toString());
            UI.addInfoRow(panel, '检查间隔', CONFIG.autoCheckInterval + ' 分钟');
            UI.addInfoRow(panel, '上次检查时间', formatTime(lastCheckTime));

            const nextCheckTime = lastCheckTime + (CONFIG.autoCheckInterval * 60 * 1000);
            const nextCheckSpan = UI.addInfoRow(panel, '下次检查时间', formatTime(nextCheckTime));

            // 添加立即检查按钮
            const checkNowButton = UI.createButton('立即检查', () => {
                GM_setValue('lastCheckTime', currentTime);
                const newNextCheckTime = currentTime + (CONFIG.autoCheckInterval * 60 * 1000);
                nextCheckSpan.textContent = formatTime(newNextCheckTime);
                debugLog('手动触发检查');

                if (needToSign) {
                    (async () => {
                        await openSignInPage();
                    })();
                } else {
                    alert('当前不需要签到');
                }
            }, '#2196F3');
            panel.appendChild(checkNowButton);
        } catch (error) {
            debugLog('更新调试面板出错:', error.message);
        }
    };

    /**
     * 脚本主函数。
     * 根据当前页面和签到状态执行相应的操作（尝试签到、打开签到页面或执行定期检查）。
     */
    const main = () => {
        debugLog('脚本已加载');
        debugLog('上次签到时间:', formatTime(lastSignTime));
        debugLog('当前时间:', formatTime(currentTime));
        debugLog('是否需要签到:', needToSign);
        debugLog('当前页面:', window.location.href);
        debugLog('签到页面:', CONFIG.signInUrl);
        debugLog('是否在签到页面:', isSignInPage);
        debugLog('上次自动检查时间:', formatTime(lastCheckTime));
        
        // 检查是否是登录页面，如果是则不执行任何操作
        if (window.location.pathname.includes('/e/member/login/')) {
            debugLog('当前是登录页面，脚本不执行任何操作');
            return;
        }

        // 如果在签到页面，则尝试签到
        if (isSignInPage) {
            debugLog('当前在签到页面，准备执行签到操作');
            // 等待页面加载完成后执行签到
            setTimeout(tryToSignIn, 2000);
            return;
        }

        // 如果不在签到页面，但需要签到，则打开签到页面
        if (needToSign) {
            debugLog('需要签到且不在签到页面，准备打开签到页面');
            (async () => {
                await openSignInPage();
            })();
            return;
        }

        // 如果配置了在任何网站上检查，且距离上次检查已经超过设定时间
        if (CONFIG.checkOnAnyWebsite) {
            const checkIntervalMs = CONFIG.autoCheckInterval * 60 * 1000;
            const timeSinceLastCheck = currentTime - lastCheckTime;

            debugLog('距离上次检查时间:', getTimeDiffInMinutes(currentTime, lastCheckTime), '分钟');
            debugLog('检查间隔设置为:', CONFIG.autoCheckInterval, '分钟');

            if (timeSinceLastCheck > checkIntervalMs) {
                debugLog('执行定期检查');
                // 更新最后检查时间
                GM_setValue('lastCheckTime', currentTime);

                // 如果需要签到，打开签到页面
                if (needToSign) {
                    debugLog('定期检查发现需要签到，准备打开签到页面');
                    (async () => {
                        await openSignInPage();
                    })();
                } else {
                    debugLog('定期检查发现不需要签到');
                }
            } else {
                debugLog('距离上次检查时间未超过设定间隔，跳过检查');
            }
        }
    };

    // 执行主函数
    main();

    /**
     * 脚本的入口点。
     * 在页面加载完成后执行主函数，并根据配置和当前页面状态决定是否添加调试面板。
     */
    // 如果在签到页面且不是登录页面，添加调试面板
    if (isSignInPage && CONFIG.debugMode && !window.location.pathname.includes('/e/member/login/')) {
        // 等待页面加载完成后添加调试面板
        setTimeout(() => {
            const panel = addDebugPanel();
            updateDebugPanelWithAutoCheck(panel);
        }, 1000);
    }
})();