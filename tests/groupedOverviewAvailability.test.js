'use strict';

import assert from 'node:assert/strict';
import {resolveApplicationGroupedOverviewAvailability} from '../build/common/groupedOverviewAvailability.js';

for (const shellVersion of ['48', '48.9', '49', '49.7']) {
    assert.deepEqual(
        resolveApplicationGroupedOverviewAvailability(shellVersion, true),
        {supported: false, enabled: false}
    );
}

for (const shellVersion of ['50', '50.0', '50.beta', '51.2']) {
    assert.deepEqual(
        resolveApplicationGroupedOverviewAvailability(shellVersion, true),
        {supported: true, enabled: true}
    );
    assert.deepEqual(
        resolveApplicationGroupedOverviewAvailability(shellVersion, false),
        {supported: true, enabled: false}
    );
}

for (const shellVersion of ['', 'unknown', '49beta', 'v50']) {
    assert.deepEqual(
        resolveApplicationGroupedOverviewAvailability(shellVersion, true),
        {supported: false, enabled: false}
    );
}

console.log('grouped overview availability tests passed');
