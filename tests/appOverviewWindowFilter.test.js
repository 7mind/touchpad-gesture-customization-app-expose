'use strict';

import {shouldShowInApplicationOverview} from '../build/src/appOverviewWindowFilter.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(
            `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
    }
}

const minimizedApplicationWindow = {minimized: true, skip_taskbar: false};
const otherWindow = {minimized: false, skip_taskbar: false};
const skippedApplicationWindow = {minimized: false, skip_taskbar: true};
const isApplicationWindow = window =>
    window === minimizedApplicationWindow ||
    window === skippedApplicationWindow;

assertEqual(
    shouldShowInApplicationOverview(
        minimizedApplicationWindow,
        isApplicationWindow
    ),
    true,
    'application overview must override global overview exclusions'
);
assertEqual(
    shouldShowInApplicationOverview(otherWindow, isApplicationWindow),
    false,
    'application overview must exclude windows from other applications'
);
assertEqual(
    shouldShowInApplicationOverview(
        skippedApplicationWindow,
        isApplicationWindow
    ),
    false,
    'application overview must retain the native skip-taskbar exclusion'
);

console.log('application overview window filter tests passed');
