(function (root) {
    const SESSION_COOKIE_NAME = '__Secure-next-auth.session-token';

    function findSessionToken(cookies) {
        const exact = cookies.find(cookie => cookie.name === SESSION_COOKIE_NAME && cookie.value);
        if (exact) {
            return exact.value;
        }

        const chunks = cookies
            .filter(cookie => cookie.name.startsWith(`${SESSION_COOKIE_NAME}.`) && cookie.value)
            .map(cookie => ({
                index: Number(cookie.name.slice(SESSION_COOKIE_NAME.length + 1)),
                value: cookie.value,
            }))
            .filter(cookie => Number.isInteger(cookie.index))
            .sort((a, b) => a.index - b.index);

        return chunks.length > 0 ? chunks.map(cookie => cookie.value).join('') : null;
    }

    async function parseApiResponse(response) {
        const responseText = await response.text();

        if (!response.ok) {
            const serverMessage = extractServerMessage(responseText);
            const detail = serverMessage ? ` ${serverMessage}` : '';

            if (serverMessage.includes('Invalid session token: Flow API request failed')) {
                throw new Error(`服务器远程校验 session token 失败: ${serverMessage}`);
            }

            throw new Error(`服务器错误: ${response.status}${detail}`);
        }

        if (!responseText.trim()) {
            return { message: 'Token更新成功' };
        }

        try {
            return JSON.parse(responseText);
        } catch (error) {
            return { message: responseText };
        }
    }

    function extractServerMessage(responseText) {
        if (!responseText) {
            return '';
        }

        try {
            const parsed = JSON.parse(responseText);
            return parsed.detail || parsed.message || responseText;
        } catch (error) {
            return responseText;
        }
    }

    function formatSuccessResult(result) {
        const message = result.message || 'Token更新成功';
        let displayMessage = `✅ Token同步成功\n${message}`;

        if (result.action === 'updated') {
            displayMessage = `✅ 成功更新到上游\n${message}`;
        } else if (result.action === 'added') {
            displayMessage = `✅ 成功添加到上游\n${message}`;
        }

        return {
            success: true,
            message,
            action: result.action,
            displayMessage,
        };
    }

    function normalizeApiUrl(apiUrl) {
        const parsedApiUrl = new URL(apiUrl);

        if (parsedApiUrl.protocol === 'http:' && parsedApiUrl.hostname === 'flow.xiaohuxing.eu.org') {
            parsedApiUrl.protocol = 'https:';
        }

        return parsedApiUrl.toString();
    }

    const api = { findSessionToken, formatSuccessResult, normalizeApiUrl, parseApiResponse };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    root.TokenUpdaterUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
