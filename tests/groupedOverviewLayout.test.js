'use strict';

import assert from 'node:assert/strict';
import {
    createGroupedOverviewLayoutOptions,
    layoutWindowsByApplication,
} from '../build/src/groupedOverviewLayout.js';

const AREA = {x: 0, y: 0, width: 1600, height: 900};
const OPTIONS = createGroupedOverviewLayoutOptions(20);

function preview(item, groupKey, x, y, width, height) {
    return {
        item,
        groupKey,
        source: {x, y, width, height},
    };
}

function contains(outer, inner) {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height
    );
}

function groupByKey(result, key) {
    const group = result.groups.find(candidate => candidate.key === key);
    assert.notEqual(group, undefined, `missing group ${key}`);
    return group;
}

{
    const result = layoutWindowsByApplication(
        [preview('only', 'editor', 100, 100, 1000, 700)],
        AREA,
        OPTIONS
    );

    assert.equal(result.groups.length, 1);
    assert.deepEqual(result.groups[0].region, AREA);
    assert.equal(result.slots.length, 1);
    assert.equal(result.slots[0].item, 'only');
}

{
    const windows = [
        preview('a', 'browser', 20, 20, 900, 700),
        preview('b', 'browser', 950, 30, 600, 700),
        preview('c', 'browser', 300, 250, 700, 500),
        preview('d', 'browser', 850, 280, 700, 500),
    ];
    const result = layoutWindowsByApplication(windows, AREA, OPTIONS);
    const group = groupByKey(result, 'browser');

    assert.equal(result.groups.length, 1);
    assert.equal(result.slots.length, windows.length);
    assert.ok(result.slots.every(slot => contains(group.region, slot)));
}

{
    const result = layoutWindowsByApplication(
        [
            preview('left', 'left-app', 50, 100, 600, 500),
            preview('middle', 'middle-app', 550, 100, 600, 500),
            preview('right', 'right-app', 1050, 100, 500, 500),
        ],
        AREA,
        OPTIONS
    );

    assert.equal(result.groups.length, 3);
    assert.ok(
        groupByKey(result, 'left-app').region.x <
            groupByKey(result, 'right-app').region.x
    );
}

{
    const result = layoutWindowsByApplication(
        [
            preview('dense-1', 'dense', 0, 0, 700, 500),
            preview('dense-2', 'dense', 100, 30, 700, 500),
            preview('dense-3', 'dense', 200, 60, 700, 500),
            preview('dense-4', 'dense', 300, 90, 700, 500),
            preview('single', 'single', 1100, 100, 400, 500),
        ],
        {x: 0, y: 0, width: 1800, height: 600},
        OPTIONS
    );
    const dense = groupByKey(result, 'dense');
    const single = groupByKey(result, 'single');
    const areaRatio =
        (dense.region.width * dense.region.height) /
        (single.region.width * single.region.height);

    assert.ok(dense.weight > single.weight);
    assert.ok(areaRatio > 1);
    assert.ok(areaRatio < 4);
}

{
    const result = layoutWindowsByApplication(
        [
            preview('far-left', 'same-app', 0, 0, 500, 500),
            preview('far-right', 'same-app', 1100, 300, 500, 500),
        ],
        AREA,
        OPTIONS
    );

    assert.equal(result.groups.length, 1);
    assert.deepEqual(result.groups[0].items, ['far-left', 'far-right']);
}

{
    const result = layoutWindowsByApplication(
        [
            preview('known', 'known-app', 0, 0, 600, 500),
            preview('unknown-1', null, 700, 0, 400, 400),
            preview('unknown-2', null, 1150, 0, 400, 400),
        ],
        AREA,
        OPTIONS
    );

    assert.equal(result.groups.length, 3);
    assert.notEqual(
        result.slots.find(slot => slot.item === 'unknown-1').groupKey,
        result.slots.find(slot => slot.item === 'unknown-2').groupKey
    );
}

{
    const windows = [
        preview('a-1', 'a', 0, 0, 600, 400),
        preview('b-1', 'b', 900, 0, 500, 700),
        preview('a-2', 'a', 100, 450, 500, 400),
        preview('b-2', 'b', 1000, 500, 500, 350),
    ];
    const first = layoutWindowsByApplication(windows, AREA, OPTIONS);
    const second = layoutWindowsByApplication(windows, AREA, OPTIONS);

    assert.deepEqual(first, second);
}

{
    const windows = [
        preview('wide', 'a', 0, 0, 1200, 500),
        preview('tall', 'a', 100, 100, 400, 800),
        preview('square', 'b', 1000, 100, 500, 500),
    ];
    const result = layoutWindowsByApplication(windows, AREA, OPTIONS);

    for (const group of result.groups) assert.ok(contains(AREA, group.region));

    for (const slot of result.slots) {
        const group = groupByKey(result, slot.groupKey);
        const source = windows.find(window => window.item === slot.item).source;

        assert.ok(contains(group.region, slot));
        assert.ok(
            Math.abs(slot.width / slot.height - source.width / source.height) <
                1e-10
        );
    }
}

{
    const result = layoutWindowsByApplication(
        [
            preview('a-1', 'a', 0, 0, 500, 400),
            preview('b-1', 'b', 800, 0, 500, 400),
            preview('a-2', 'a', 100, 450, 500, 400),
            preview('c-1', 'c', 1200, 450, 300, 300),
            preview('b-2', 'b', 900, 450, 500, 400),
        ],
        AREA,
        OPTIONS
    );
    const completedGroups = new Set();
    let currentGroup = result.slots[0].groupKey;

    for (const slot of result.slots) {
        if (slot.groupKey === currentGroup) continue;

        completedGroups.add(currentGroup);
        assert.equal(completedGroups.has(slot.groupKey), false);
        currentGroup = slot.groupKey;
    }
}

console.log('grouped overview layout tests passed');
