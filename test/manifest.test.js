const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

test('manifest permits the Flow2API HTTP plugin endpoint', () => {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

    assert.ok(
        manifest.host_permissions.includes('http://flow.xiaohuxing.eu.org/*'),
        'missing permission for http://flow.xiaohuxing.eu.org/*'
    );
});
