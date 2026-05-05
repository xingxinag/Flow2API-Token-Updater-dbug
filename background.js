// background.js - Chrome扩展后台脚本

importScripts('token-utils.js');

const { findSessionToken, formatSuccessResult, normalizeApiUrl, parseApiResponse } = TokenUpdaterUtils;

// 定时器名称
const ALARM_NAME = 'tokenRefresh';

// 日志系统
const Logger = {
    async log(level, message, details = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            details
        };

        console.log(`[${level}] ${message}`, details || '');

        // 存储到chrome.storage.local（单次会话有效）
        const { logs = [] } = await chrome.storage.local.get(['logs']);
        logs.unshift(logEntry); // 最新的在前面

        // 只保留最近50条日志
        if (logs.length > 50) {
            logs.splice(50);
        }

        await chrome.storage.local.set({ logs });
    },

    info(message, details) {
        return this.log('INFO', message, details);
    },

    error(message, details) {
        return this.log('ERROR', message, details);
    },

    success(message, details) {
        return this.log('SUCCESS', message, details);
    },

    async getLogs() {
        const { logs = [] } = await chrome.storage.local.get(['logs']);
        return logs;
    },

    async clearLogs() {
        await chrome.storage.local.set({ logs: [] });
    }
};

// 初始化：设置定时器
chrome.runtime.onInstalled.addListener(async () => {
    await Logger.info('Flow2API Token Updater installed');
    await setupAlarm();
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateConfig') {
        // 更新配置后重新设置定时器
        setupAlarm().then(async () => {
            await Logger.info('Config updated, alarm reset');
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    } else if (request.action === 'testNow') {
        // 立即执行一次
        extractAndSendToken().then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true; // 保持消息通道开启
    } else if (request.action === 'getLogs') {
        // 获取日志
        Logger.getLogs().then((logs) => {
            sendResponse({ success: true, logs });
        });
        return true;
    } else if (request.action === 'clearLogs') {
        // 清除日志
        Logger.clearLogs().then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
});

// 监听定时器触发
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
        await Logger.info('Alarm triggered, extracting token...');
        const result = await extractAndSendToken();

        // 发送通知
        if (result.success) {
            const title = result.action === 'updated' ? '✅ Token已更新' : '✅ Token已添加';
            const message = result.displayMessage || result.message || 'Token已成功同步到Flow2API';

            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: title,
                message: message
            });
        } else {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: '❌ Token同步失败',
                message: result.error || '未知错误'
            });
        }
    }
});

// 设置定时器
async function setupAlarm() {
    // 清除旧的定时器
    await chrome.alarms.clear(ALARM_NAME);

    // 获取配置
    const config = await chrome.storage.sync.get(['refreshInterval']);
    const intervalMinutes = config.refreshInterval || 60;

    // 创建新的定时器
    chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: intervalMinutes
    });

    await Logger.info(`Alarm set to ${intervalMinutes} minutes`);
}

// 提取cookie并发送到服务器
async function extractAndSendToken() {
    let tab = null;

    try {
        await Logger.info('开始提取Token...');

        // 获取配置
        const config = await chrome.storage.sync.get(['apiUrl', 'connectionToken']);

        if (!config.apiUrl || !config.connectionToken) {
            await Logger.error('配置未设置');
            return { success: false, error: '配置未设置' };
        }

        await Logger.info('配置已加载', { apiUrl: config.apiUrl });

        // 1. 打开Google Labs页面（在后台）
        await Logger.info('正在打开Google Labs页面...');
        tab = await chrome.tabs.create({
            url: 'https://labs.google/fx/vi/tools/flow',
            active: false
        });

        await Logger.info('页面已创建，等待加载...', { tabId: tab.id });

        // 等待页面完全加载
        await new Promise((resolve) => {
            const listener = (tabId, changeInfo) => {
                if (tabId === tab.id && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });

        await Logger.info('页面加载完成，等待JavaScript执行...');

        // 增加等待时间到5秒，确保JavaScript完全执行
        await new Promise(resolve => setTimeout(resolve, 5000));

        await Logger.info('开始提取Cookies...');

        // 2. 获取session-token
        let sessionToken = null;
        let allCookiesFound = [];

        // 尝试获取所有google相关的cookies
        try {
            // 方法1: 获取当前标签页的所有cookies
            const tabCookies = await chrome.cookies.getAll({ url: 'https://labs.google/fx/vi/tools/flow' });
            allCookiesFound.push(...tabCookies);
            await Logger.info(`从标签页URL找到 ${tabCookies.length} 个cookies`);

            // 方法2: 获取labs.google域名下的所有cookies
            const labsCookies = await chrome.cookies.getAll({ domain: 'labs.google' });
            allCookiesFound.push(...labsCookies);
            await Logger.info(`从labs.google域名找到 ${labsCookies.length} 个cookies`);

            // 方法3: 获取.google.com域名下的所有cookies
            const googleCookies = await chrome.cookies.getAll({ domain: '.google.com' });
            allCookiesFound.push(...googleCookies);
            await Logger.info(`从.google.com域名找到 ${googleCookies.length} 个cookies`);

        } catch (err) {
            await Logger.error('获取cookies失败', { error: err.message });
        }

        // 去重所有找到的cookies
        const uniqueCookies = Array.from(
            new Map(allCookiesFound.map(c => [c.name + c.domain, c])).values()
        );

        await Logger.info(`总共找到 ${uniqueCookies.length} 个唯一cookies`, {
            cookieNames: uniqueCookies.map(c => ({ name: c.name, domain: c.domain }))
        });

        sessionToken = findSessionToken(uniqueCookies);

        if (sessionToken) {
            const tokenCookie = uniqueCookies.find(cookie => cookie.value && sessionToken.includes(cookie.value));
            await Logger.success('找到session-token', {
                domain: tokenCookie ? tokenCookie.domain : undefined,
                path: tokenCookie ? tokenCookie.path : undefined,
                length: sessionToken.length
            });
        }

        // 关闭标签页
        if (tab) {
            await chrome.tabs.remove(tab.id);
            await Logger.info('标签页已关闭');
        }

        if (!sessionToken) {
            await Logger.error('未找到session-token', {
                foundCookies: uniqueCookies.map(c => ({
                    name: c.name,
                    domain: c.domain
                }))
            });

            return {
                success: false,
                error: '未找到session-token。请确保已登录Google Labs。'
            };
        }

        await Logger.info('Session-token提取成功', { tokenLength: sessionToken.length });

        // 4. 发送到服务器
        let requestApiUrl = config.apiUrl;
        let parsedApiUrl = null;
        try {
            requestApiUrl = normalizeApiUrl(config.apiUrl);
            parsedApiUrl = new URL(requestApiUrl);
        } catch (e) {
            await Logger.error('API URL 格式无效', {
                apiUrl: config.apiUrl,
                error: e.message
            });
            return { success: false, error: 'API URL 格式无效，请检查配置' };
        }

        await Logger.info('正在发送到服务器...', {
            apiUrl: requestApiUrl,
            protocol: parsedApiUrl.protocol,
            host: parsedApiUrl.host,
            hostname: parsedApiUrl.hostname,
            isLocalhost: ['127.0.0.1', 'localhost'].includes(parsedApiUrl.hostname)
        });

        let response;
        try {
            response = await fetch(requestApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.connectionToken}`
                },
                body: JSON.stringify({
                    session_token: sessionToken
                })
            });
        } catch (fetchError) {
            await Logger.error('发送到服务器失败', {
                apiUrl: config.apiUrl,
                protocol: parsedApiUrl.protocol,
                host: parsedApiUrl.host,
                hostname: parsedApiUrl.hostname,
                isLocalhost: ['127.0.0.1', 'localhost'].includes(parsedApiUrl.hostname),
                hint: ['127.0.0.1', 'localhost'].includes(parsedApiUrl.hostname)
                    ? '请确认本地服务已启动，并监听对应端口；若使用 localhost 失败，可改用 127.0.0.1 再试。'
                    : parsedApiUrl.protocol === 'https:'
                        ? '请确认目标 HTTPS 证书有效，接口可从浏览器直接访问。'
                        : '请确认接口地址可访问，且扩展已重新加载以应用新的 host_permissions。',
                error: fetchError.message,
                stack: fetchError.stack
            });
            throw fetchError;
        }

        let result;
        try {
            result = await parseApiResponse(response);
        } catch (error) {
            await Logger.error('服务器错误', {
                status: response.status,
                error: error.message
            });
            return { success: false, error: error.message };
        }

        // 根据action显示不同的日志信息
        if (result.action === 'updated') {
            await Logger.success('✅ Token已更新到上游', {
                action: '更新现有Token',
                message: result.message
            });
        } else if (result.action === 'added') {
            await Logger.success('✅ Token已添加到上游', {
                action: '添加新Token',
                message: result.message
            });
        } else {
            await Logger.success('✅ Token已同步到上游', result);
        }

        return formatSuccessResult(result);

    } catch (error) {
        await Logger.error('提取过程出错', {
            error: error.message,
            stack: error.stack
        });

        // 确保关闭标签页
        if (tab) {
            try {
                await chrome.tabs.remove(tab.id);
            } catch (e) {
                // 忽略关闭标签页的错误
            }
        }

        return { success: false, error: error.message };
    }
}
