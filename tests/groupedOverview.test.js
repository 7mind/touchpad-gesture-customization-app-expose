'use strict';

import assert from 'node:assert/strict';
import {ApplicationGroupedOverviewExtension} from '../build/src/groupedOverview.js';

function createHarness(prototype) {
    const reports = [];
    let invalidations = 0;
    let resolutions = 0;
    const extension = new ApplicationGroupedOverviewExtension({
        workspaceLayoutPrototype: prototype,
        resolveAppKey: window => {
            resolutions++;
            return window.appKey;
        },
        invalidateLayouts: () => invalidations++,
        report: (message, error) => reports.push({message, error}),
    });

    return {
        extension,
        reports,
        invalidations: () => invalidations,
        resolutions: () => resolutions,
    };
}

function createSupportedPrototype() {
    const stockStrategy = {
        computeWindowSlots() {
            return [[1, 2, 3, 4, 'stock']];
        },
    };
    const original = function () {
        this._layoutStrategy = stockStrategy;
        return {kind: 'stock'};
    };
    const prototype = {
        _createBestLayout: original,
        _getWindowSlots() {
            return [];
        },
        _adjustSpacingAndPadding() {
            return [20, 20, null];
        },
    };

    return {original, prototype};
}

function createLayout(prototype, windows) {
    return Object.assign(Object.create(prototype), {
        _spacing: 20,
        _sortedWindows: windows,
        _layoutStrategy: null,
    });
}

{
    const {original, prototype} = createSupportedPrototype();
    const harness = createHarness(prototype);

    assert.equal(harness.extension.supported, true);
    harness.extension.apply();
    assert.equal(harness.invalidations(), 1);
    assert.notEqual(prototype._createBestLayout, original);

    const layout = createLayout(prototype, [
        {
            metaWindow: {appKey: 'browser'},
            boundingBox: {x: 0, y: 0, width: 800, height: 600},
        },
        {
            metaWindow: {appKey: 'browser'},
            boundingBox: {x: 800, y: 0, width: 800, height: 600},
        },
    ]);
    const groupedLayout = layout._createBestLayout({
        x: 0,
        y: 0,
        width: 1600,
        height: 900,
    });
    const slots = layout._layoutStrategy.computeWindowSlots(groupedLayout, {
        x: 0,
        y: 0,
        width: 1600,
        height: 900,
    });
    layout._layoutStrategy.computeWindowSlots(groupedLayout, {
        x: 0,
        y: 0,
        width: 1200,
        height: 700,
    });

    assert.equal(slots.length, 2);
    assert.equal(slots[0][4], layout._sortedWindows[0]);
    assert.equal(slots[1][4], layout._sortedWindows[1]);
    assert.equal(harness.resolutions(), 2);

    harness.extension.destroy();
    assert.equal(prototype._createBestLayout, original);
    assert.equal(harness.invalidations(), 2);
    assert.deepEqual(harness.reports, []);
}

{
    const {prototype} = createSupportedPrototype();
    const harness = createHarness(prototype);
    const foreignPatch = function () {
        return {kind: 'foreign'};
    };

    harness.extension.apply();
    prototype._createBestLayout = foreignPatch;
    harness.extension.destroy();

    assert.equal(prototype._createBestLayout, foreignPatch);
    assert.equal(harness.invalidations(), 1);
    assert.equal(harness.reports.length, 1);
}

{
    const harness = createHarness(null);

    assert.equal(harness.extension.supported, false);
    harness.extension.apply();
    harness.extension.destroy();

    assert.equal(harness.invalidations(), 0);
    assert.equal(harness.reports.length, 1);
}

{
    const {prototype} = createSupportedPrototype();
    const harness = createHarness(prototype);
    const layout = createLayout(prototype, [
        {
            metaWindow: {appKey: 'invalid'},
            boundingBox: {x: 0, y: 0, width: 0, height: 600},
        },
    ]);

    harness.extension.apply();
    const groupedLayout = layout._createBestLayout({
        x: 0,
        y: 0,
        width: 1600,
        height: 900,
    });
    const slots = layout._layoutStrategy.computeWindowSlots(groupedLayout, {
        x: 0,
        y: 0,
        width: 1600,
        height: 900,
    });

    assert.deepEqual(slots, [[1, 2, 3, 4, 'stock']]);
    assert.equal(harness.reports.length, 1);
}

console.log('grouped overview lifecycle tests passed');
