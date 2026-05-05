const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

test('immediate test saves the currently typed config before sending testNow', async () => {
    const listeners = {};
    const elements = {
        apiUrl: input('http://flow.xiaohuxing.eu.org/api/plugin/update-token'),
        connectionToken: input('secret-token'),
        refreshInterval: input('360'),
        saveBtn: button(),
        testBtn: button(),
        logsBtn: button(),
        status: status(),
    };
    const storageSets = [];
    const messages = [];
    const context = {
        document: {
            addEventListener(event, handler) {
                listeners[event] = handler;
            },
            getElementById(id) {
                return elements[id];
            },
        },
        chrome: {
            storage: {
                sync: {
                    get: async () => ({}),
                    set: async (value) => {
                        storageSets.push(value);
                    },
                },
            },
            runtime: {
                sendMessage(message, callback) {
                    messages.push(message);
                    if (callback) {
                        callback({ success: false, error: 'expected test stop' });
                    }
                },
            },
        },
        window: { location: { href: '' } },
        setTimeout,
    };

    vm.runInNewContext(readFileSync('popup.js', 'utf8'), context);
    await listeners.DOMContentLoaded();
    await elements.testBtn.click();

    assert.equal(JSON.stringify(storageSets.at(-1)), JSON.stringify({
        apiUrl: 'http://flow.xiaohuxing.eu.org/api/plugin/update-token',
        connectionToken: 'secret-token',
        refreshInterval: 360,
    }));
    assert.equal(JSON.stringify(messages.at(-1)), JSON.stringify({ action: 'testNow' }));
});

function input(value) {
    return { value };
}

function status() {
    return {
        textContent: '',
        className: '',
        style: { display: 'none' },
    };
}

function button() {
    const listeners = {};
    return {
        addEventListener(event, handler) {
            listeners[event] = handler;
        },
        async click() {
            await listeners.click();
        },
    };
}
