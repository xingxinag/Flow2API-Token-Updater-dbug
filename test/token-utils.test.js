const assert = require('node:assert/strict');
const test = require('node:test');

const {
    findSessionToken,
    formatSuccessResult,
    parseApiResponse,
} = require('../token-utils.js');

test('findSessionToken returns the exact NextAuth session token', () => {
    const token = findSessionToken([
        { name: 'other', value: 'ignored' },
        { name: '__Secure-next-auth.session-token', value: 'session-value' },
    ]);

    assert.equal(token, 'session-value');
});

test('findSessionToken combines chunked NextAuth session token cookies in order', () => {
    const token = findSessionToken([
        { name: '__Secure-next-auth.session-token.1', value: 'part-b' },
        { name: '__Secure-next-auth.session-token.0', value: 'part-a' },
    ]);

    assert.equal(token, 'part-apart-b');
});

test('parseApiResponse accepts JSON success responses', async () => {
    const result = await parseApiResponse({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ action: 'updated', message: 'ok' }),
    });

    assert.deepEqual(result, { action: 'updated', message: 'ok' });
});

test('parseApiResponse accepts empty success responses', async () => {
    const result = await parseApiResponse({
        ok: true,
        status: 204,
        text: async () => '',
    });

    assert.deepEqual(result, { message: 'Token更新成功' });
});

test('parseApiResponse includes server text for failed responses', async () => {
    await assert.rejects(
        parseApiResponse({
            ok: false,
            status: 500,
            text: async () => 'upstream failed',
        }),
        /服务器错误: 500 upstream failed/
    );
});

test('formatSuccessResult does not label unknown success responses as added', () => {
    assert.deepEqual(formatSuccessResult({ message: 'plain success' }), {
        success: true,
        message: 'plain success',
        action: undefined,
        displayMessage: '✅ Token同步成功\nplain success',
    });
});
