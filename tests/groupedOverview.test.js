'use strict';

import assert from 'node:assert/strict';
import {ApplicationGroupedOverviewExtension} from '../build/src/groupedOverview.js';
import {setOverviewPreviewStacking} from '../build/src/groupedOverviewStacking.js';

function createHarness(prototype) {
    const reports = [];
    let invalidations = 0;
    let resolutions = 0;
    let applicationOverviewActive = false;
    let stacking = [];
    let headerHeight = 0;
    const chrome = new Map();
    const extension = new ApplicationGroupedOverviewExtension({
        workspaceLayoutPrototype: prototype,
        resolveAppKey: window => {
            resolutions++;
            return window.appKey;
        },
        resolveFallbackSource: window =>
            window.frame ?? {x: 0, y: 0, width: 0, height: 0},
        invalidateLayouts: () => invalidations++,
        isApplicationOverviewActive: () => applicationOverviewActive,
        getGroupHeaderHeight: () => headerHeight,
        getGroupHeaderPosition: () => 'top',
        updateGroupChrome: (layout, groups) => chrome.set(layout, groups),
        destroyGroupChrome: () => chrome.clear(),
        setPreviewStacking: previews => {
            stacking = [...previews];
        },
        restorePreviewStacking: () => {
            stacking = [];
        },
        restoreStacking: () => {
            stacking = [];
        },
        report: (message, error) => reports.push({message, error}),
    });

    return {
        extension,
        reports,
        invalidations: () => invalidations,
        resolutions: () => resolutions,
        stacking: () => stacking,
        chrome: layout => chrome.get(layout),
        setHeaderHeight: height => {
            headerHeight = height;
        },
        setStacking: previews => {
            stacking = [...previews];
        },
        setApplicationOverviewActive: active => {
            applicationOverviewActive = active;
        },
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
        syncStacking() {},
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
            metaWindow: {appKey: 'terminal'},
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
    const transientSlots = layout._layoutStrategy.computeWindowSlots(
        groupedLayout,
        {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
        }
    );

    assert.equal(slots.length, 2);
    assert.equal(slots[0][4], layout._sortedWindows[0]);
    assert.equal(slots[1][4], layout._sortedWindows[1]);
    assert.deepEqual(transientSlots, [[1, 2, 3, 4, 'stock']]);
    assert.deepEqual(harness.stacking(), []);
    assert.equal(harness.resolutions(), 2);

    harness.extension.destroy();
    assert.equal(prototype._createBestLayout, original);
    assert.equal(harness.invalidations(), 2);
    assert.deepEqual(harness.reports, []);
}

{
    const {prototype} = createSupportedPrototype();
    const harness = createHarness(prototype);
    const preview = {
        metaWindow: {
            appKey: 'browser',
            frame: {x: 100, y: 50, width: 800, height: 600},
        },
        boundingBox: {x: 0, y: 0, width: 0, height: 0},
    };
    const layout = createLayout(prototype, [preview]);

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

    assert.equal(slots.length, 1);
    assert.equal(slots[0][4], preview);
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
    assert.deepEqual(harness.reports, []);
}

{
    const {prototype} = createSupportedPrototype();
    const harness = createHarness(prototype);
    const layout = createLayout(prototype, [
        {
            metaWindow: {appKey: 'invalid'},
            boundingBox: {x: 0, y: 0, width: -1, height: 600},
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

{
    const {prototype} = createSupportedPrototype();

    prototype.syncStacking = function () {
        harness.setStacking([...this._sortedWindows].reverse());
    };

    const originalSyncStacking = prototype.syncStacking;
    const harness = createHarness(prototype);
    const previews = [0, 1, 2].map(index => ({
        metaWindow: {appKey: 'browser'},
        boundingBox: {x: index * 100, y: 0, width: 800, height: 600},
    }));
    const layout = createLayout(prototype, previews);
    const area = {x: 0, y: 0, width: 1600, height: 900};

    harness.extension.apply();
    const groupedLayout = layout._createBestLayout(area);
    const slots = layout._layoutStrategy.computeWindowSlots(
        groupedLayout,
        area
    );

    assert.deepEqual(
        harness.stacking(),
        slots.map(slot => slot[4]),
        'spiral slots determine preview stacking order'
    );

    layout.syncStacking({0: 2, 1: 1, 2: 0});
    assert.deepEqual(
        harness.stacking(),
        slots.map(slot => slot[4])
    );

    harness.setApplicationOverviewActive(true);
    const spreadLayout = layout._createBestLayout(area);
    const spreadSlots = layout._layoutStrategy.computeWindowSlots(
        spreadLayout,
        area
    );
    assert.deepEqual(harness.stacking(), []);

    for (let index = 0; index < spreadSlots.length; index++) {
        const [x, y, width, height] = spreadSlots[index];
        for (const other of spreadSlots.slice(index + 1))
            assert.ok(
                x + width <= other[0] ||
                    other[0] + other[2] <= x ||
                    y + height <= other[1] ||
                    other[1] + other[3] <= y,
                'App Expose spreads every window without overlap'
            );
    }

    harness.setApplicationOverviewActive(false);
    const restoredLayout = layout._createBestLayout(area);
    const installedStrategy = layout._layoutStrategy;
    installedStrategy.computeWindowSlots(restoredLayout, area);
    assert.deepEqual(
        harness.stacking(),
        slots.map(slot => slot[4])
    );

    layout._sortedWindows = previews.slice(1);
    layout.syncStacking({1: 2, 2: 1});
    assert.deepEqual(harness.stacking(), previews.slice(1));

    harness.extension.destroy();
    assert.equal(prototype.syncStacking, originalSyncStacking);
    assert.deepEqual(harness.stacking(), []);
    assert.deepEqual(
        installedStrategy.computeWindowSlots(restoredLayout, area),
        [[1, 2, 3, 4, 'stock']]
    );
}

{
    const {prototype} = createSupportedPrototype();
    const harness = createHarness(prototype);
    const layout = createLayout(prototype, []);
    const area = {x: 0, y: 0, width: 1600, height: 900};

    harness.extension.apply();
    const installedLayout = prototype._createBestLayout;
    const installedStacking = prototype.syncStacking;

    const foreignLayout = function (rectangle) {
        return installedLayout.call(this, rectangle);
    };

    const foreignStacking = function (stackIndices) {
        installedStacking.call(this, stackIndices);
    };

    prototype._createBestLayout = foreignLayout;
    prototype.syncStacking = foreignStacking;

    harness.extension.destroy();
    assert.equal(prototype._createBestLayout, foreignLayout);
    assert.equal(prototype.syncStacking, foreignStacking);
    assert.deepEqual(layout._createBestLayout(area), {kind: 'stock'});
    assert.equal(harness.reports.length, 2);

    harness.extension.apply();
    assert.deepEqual(installedLayout.call(layout, area), {kind: 'stock'});
    harness.extension.destroy();
}

function createSiblingContainer() {
    return {
        children: [],
        get_parent() {
            return null;
        },
        place(preview, sibling, top) {
            assert.equal(preview.parent, this);
            const index = this.children.indexOf(preview);
            assert.notEqual(index, -1);
            this.children.splice(index, 1);

            if (sibling === null) {
                if (top) this.children.push(preview);
                else this.children.unshift(preview);
            } else {
                assert.equal(sibling.parent, this);
                const siblingIndex = this.children.indexOf(sibling);
                assert.notEqual(siblingIndex, -1);
                this.children.splice(siblingIndex + 1, 0, preview);
            }
        },
    };
}

function createStackablePreview(parent) {
    const preview = {
        parent,
        inDrag: false,
        _overlayShown: false,
        _stackAbove: null,
        get_parent() {
            return this.parent;
        },
        setStackAbove(sibling) {
            this._stackAbove = sibling;
            if (!this.inDrag) this.parent.place(this, sibling, false);
        },
        _restack() {
            this.parent.place(
                this,
                this._overlayShown ? null : this._stackAbove,
                this._overlayShown
            );
        },
    };
    parent.children.push(preview);
    return preview;
}

{
    const workspace = createSiblingContainer();
    const dragLayer = createSiblingContainer();
    const first = createStackablePreview(workspace);
    const second = createStackablePreview(workspace);
    const third = createStackablePreview(workspace);

    setOverviewPreviewStacking([third, first, second]);
    assert.deepEqual(workspace.children, [third, first, second]);

    first._overlayShown = true;
    first._restack();
    setOverviewPreviewStacking([third, first, second]);
    assert.deepEqual(workspace.children, [third, second, first]);
    first._overlayShown = false;
    first._restack();
    assert.deepEqual(workspace.children, [third, first, second]);

    first.inDrag = true;
    workspace.children.splice(workspace.children.indexOf(first), 1);
    dragLayer.children.push(first);
    first.parent = dragLayer;
    setOverviewPreviewStacking([second, first, third]);
    assert.deepEqual(workspace.children, [second, third]);
    assert.deepEqual(dragLayer.children, [first]);

    dragLayer.children.pop();
    workspace.children.push(first);
    first.parent = workspace;
    first.inDrag = false;
    first._restack();
    assert.deepEqual(workspace.children, [second, first, third]);

    first.parent = null;
    workspace.children.splice(workspace.children.indexOf(first), 1);
    setOverviewPreviewStacking([third, first, second]);
    assert.deepEqual(workspace.children, [third, second]);
}

{
    const {prototype} = createSupportedPrototype();
    const harness = createHarness(prototype);
    const layout = createLayout(prototype, [
        {
            metaWindow: {appKey: 'editor'},
            boundingBox: {x: 0, y: 0, width: 800, height: 600},
        },
    ]);
    const area = {x: 0, y: 0, width: 1600, height: 900};
    harness.setHeaderHeight(36);
    harness.extension.apply();
    let engine = layout._createBestLayout(area);
    layout._layoutStrategy.computeWindowSlots(engine, area);
    assert.equal(harness.chrome(layout)[0].header.height, 36);
    const originalWindows = layout._sortedWindows;
    layout._sortedWindows = [];
    layout._createBestLayout(area);
    assert.deepEqual(
        harness.chrome(layout),
        [],
        'empty workspaces must clear headers even when Shell skips slot calculation'
    );
    layout._sortedWindows = originalWindows;
    engine = layout._createBestLayout(area);
    layout._layoutStrategy.computeWindowSlots(engine, area);
    layout._layoutStrategy.computeWindowSlots(engine, {...area, height: 10});
    assert.deepEqual(
        harness.chrome(layout),
        [],
        'stock fallback must clear stale headers'
    );
    harness.setApplicationOverviewActive(true);
    engine = layout._createBestLayout(area);
    layout._layoutStrategy.computeWindowSlots(engine, area);
    assert.equal(
        harness.chrome(layout)[0].header,
        null,
        'App Exposé must reserve no header space'
    );
    harness.extension.destroy();
    assert.equal(
        harness.chrome(layout),
        undefined,
        'disable must clear all published chrome'
    );
}

console.log('grouped overview lifecycle tests passed');
