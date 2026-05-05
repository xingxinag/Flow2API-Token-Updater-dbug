const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

test('updateConfig acknowledges after resetting the alarm', async () => {
    let messageListener;
    const context = {
        console,
        URL,
        setTimeout,
        importScripts(file) {
            vm.runInContext(readFileSync(file, 'utf8'), context);
        },
        chrome: {
            runtime: {
                onInstalled: { addListener() {} },
                onMessage: {
                    addListener(listener) {
                        messageListener = listener;
                    },
                },
            },
            alarms: {
                clear: async () => true,
                create() {},
                onAlarm: { addListener() {} },
            },
            storage: {
                sync: { get: async () => ({ refreshInterval: 60 }) },
                local: {
                    get: async () => ({ logs: [] }),
                    set: async () => {},
                },
            },
            notifications: { create() {} },
        },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync('background.js', 'utf8'), context);

    const response = await new Promise((resolve) => {
        const keptOpen = messageListener({ action: 'updateConfig' }, {}, resolve);
        assert.equal(keptOpen, true);
    });

    assert.equal(JSON.stringify(response), JSON.stringify({ success: true }));
});
