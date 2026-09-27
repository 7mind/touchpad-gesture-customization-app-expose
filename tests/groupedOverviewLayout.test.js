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

function exposedArea(window, foreground) {
    const right = window.x + window.width;
    const bottom = window.y + window.height;
    const cuts = [
        ...new Set([
            window.x,
            right,
            ...foreground.flatMap(slot => [
                Math.max(window.x, Math.min(right, slot.x)),
                Math.max(window.x, Math.min(right, slot.x + slot.width)),
            ]),
        ]),
    ].sort((a, b) => a - b);
    let area = 0;

    for (let index = 1; index < cuts.length; index++) {
        const left = cuts[index - 1];
        const x = (left + cuts[index]) / 2;
        const intervals = foreground
            .filter(slot => slot.x < x && slot.x + slot.width > x)
            .map(slot => [
                Math.max(window.y, slot.y),
                Math.min(bottom, slot.y + slot.height),
            ])
            .filter(([start, end]) => end > start)
            .sort(([a], [b]) => a - b);
        let end = window.y;
        let covered = 0;

        for (const [start, nextEnd] of intervals) {
            covered += Math.max(0, nextEnd - Math.max(start, end));
            end = Math.max(end, nextEnd);
        }

        area += (cuts[index] - left) * (window.height - covered);
    }

    return area;
}

for (const sizes of [
    [
        [300, 200],
        [1200, 900],
    ],
    Array.from({length: 12}, () => [800, 600]),
    Array.from({length: 40}, (_, index) =>
        index % 2 === 0 ? [1200, 400] : [300, 900]
    ),
]) {
    const windows = sizes.map(([width, height], index) =>
        preview(`visible-${index}`, 'stack', 0, 0, width, height)
    );
    const result = layoutWindowsByApplication(windows, AREA, OPTIONS);

    for (let index = 0; index < result.slots.length; index++) {
        const slot = result.slots[index];
        const visible = exposedArea(slot, result.slots.slice(index + 1));

        assert.ok(
            visible >= slot.width * slot.height * 0.1 - 1e-6,
            `stack window ${index} must retain at least 10% exposed area`
        );
    }
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

{
    const windows = Array.from({length: 9}, (_, index) =>
        preview(`stack-${index}`, 'stack', index * 80, 0, 800, 600)
    );
    const result = layoutWindowsByApplication(windows, AREA, OPTIONS);
    const center = slot => ({
        x: slot.x + slot.width / 2,
        y: slot.y + slot.height / 2,
    });
    const origin = center(result.slots[0]);
    let previousRadius = 0;

    assert.deepEqual(
        result.slots.map(slot => slot.item),
        windows.map(window => window.item)
    );

    for (let index = 1; index < result.slots.length; index++) {
        const previous = result.slots[index - 1];
        const slot = result.slots[index];
        const point = center(slot);
        const radius = Math.hypot(point.x - origin.x, point.y - origin.y);

        assert.ok(
            slot.x < previous.x + previous.width &&
                previous.x < slot.x + slot.width &&
                slot.y < previous.y + previous.height &&
                previous.y < slot.y + slot.height,
            'successive windows must overlap in the application stack'
        );
        assert.ok(radius > previousRadius, 'the spiral must expand outward');

        if (index > 1) {
            const before = center(previous);
            const cross =
                (before.x - origin.x) * (point.y - origin.y) -
                (before.y - origin.y) * (point.x - origin.x);
            assert.ok(
                cross > 0,
                'the spiral must turn clockwise in screen coordinates'
            );
        }

        assert.ok(contains(AREA, slot));
        previousRadius = radius;
    }
}

{
    const windows = Array.from({length: 6}, (_, index) =>
        preview(`expose-${index}`, 'editor', index * 80, 0, 800, 600)
    );
    const result = layoutWindowsByApplication(windows, AREA, {
        ...OPTIONS,
        windowLayout: 'spread',
    });

    assert.deepEqual(result.groups[0].region, AREA);

    for (const slot of result.slots) {
        for (const other of result.slots) {
            if (slot === other) continue;

            assert.ok(
                slot.x >= other.x + other.width ||
                    other.x >= slot.x + slot.width ||
                    slot.y >= other.y + other.height ||
                    other.y >= slot.y + slot.height,
                'App Exposé must keep every window fully exposed'
            );
        }
    }
}

for (const count of [1, 2, 3, 12, 40]) {
    for (const area of [AREA, {x: -900, y: 120, width: 700, height: 1200}]) {
        const windows = Array.from({length: count}, (_, index) =>
            preview(
                `mixed-${index}`,
                'mixed',
                index * 30,
                index * 20,
                index % 2 === 0 ? 1200 : 300,
                index % 2 === 0 ? 400 : 900
            )
        );
        const result = layoutWindowsByApplication(windows, area, OPTIONS);

        assert.equal(result.slots.length, count);

        for (const slot of result.slots) {
            const source = windows.find(
                window => window.item === slot.item
            ).source;

            assert.ok(contains(area, slot));
            assert.ok(slot.width > 0 && slot.height > 0);
            assert.ok(
                slot.width <= source.width * OPTIONS.maxWindowScale + 1e-10
            );
            assert.ok(
                Math.abs(
                    slot.width / slot.height - source.width / source.height
                ) < 1e-10
            );
        }
    }
}

{
    const windows = [
        preview('editor-1', 'editor', 0, 0, 1000, 700),
        preview('editor-2', 'editor', 100, 50, 800, 600),
        preview('browser', 'browser', 900, 0, 600, 600),
    ];
    const result = layoutWindowsByApplication(windows, AREA, {
        ...OPTIONS,
        groupHeaderHeight: 36,
    });

    for (const group of result.groups) {
        assert.ok(
            group.header,
            'application groups must reserve an icon/name header'
        );
        assert.equal(group.header.height, 36);
        assert.ok(contains(group.region, group.header));

        for (const slot of result.slots.filter(
            slot => slot.groupKey === group.key
        ))
            assert.ok(
                slot.y >=
                    group.header.y + group.header.height + OPTIONS.groupPadding,
                'application headers must not cover window previews'
            );
    }

    assert.throws(
        () =>
            layoutWindowsByApplication(
                windows.slice(0, 1),
                {x: 0, y: 0, width: 100, height: 20},
                {...OPTIONS, groupHeaderHeight: 36}
            ),
        /too small/
    );
}

console.log('grouped overview layout tests passed');
