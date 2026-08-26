'use strict';

import assert from 'node:assert/strict';
import {NestedScrollGestureController} from '../build/common/nestedScrollGesture.js';

class FakeScheduler {
    callbacks = new Map();
    nextId = 1;

    schedule(_delay, callback) {
        const id = this.nextId++;

        this.callbacks.set(id, callback);
        return id;
    }

    cancel(id) {
        this.callbacks.delete(id);
    }

    run(id) {
        const callback = this.callbacks.get(id);

        assert.notEqual(callback, undefined);
        this.callbacks.delete(id);
        callback();
    }
}

function sample(time, dx, dy, smooth = true) {
    return {time, x: 40, y: 60, dx, dy, smooth};
}

function createHarness() {
    const events = [];
    const scheduler = new FakeScheduler();
    const controller = new NestedScrollGestureController({
        distance: 300,
        multiplier: 10,
        endDelayMs: 250,
        scheduler,
        begin: (time, x, y) => events.push({type: 'begin', time, x, y}),
        update: (time, delta, distance) =>
            events.push({type: 'update', time, delta, distance}),
        end: (time, distance) => events.push({type: 'end', time, distance}),
    });

    return {controller, events, scheduler};
}

{
    const {controller, events, scheduler} = createHarness();

    assert.equal(controller.handle(sample(1, 0, -2, false)), false);
    assert.equal(controller.handle(sample(2, 3, 1)), false);
    assert.deepEqual(events, []);

    assert.equal(controller.handle(sample(3, 1, -2)), true);
    assert.deepEqual(events, [
        {type: 'begin', time: 3, x: 40, y: 60},
        {type: 'update', time: 3, delta: -20, distance: 300},
    ]);
    assert.equal(scheduler.callbacks.size, 1);

    assert.equal(controller.handle(sample(4, 0, 3)), true);
    assert.deepEqual(events[2], {
        type: 'update',
        time: 4,
        delta: 30,
        distance: 300,
    });
    assert.equal(events.filter(event => event.type === 'begin').length, 1);
    assert.equal(scheduler.callbacks.size, 1);

    assert.equal(controller.handle(sample(5, 0, 0)), true);
    assert.deepEqual(events[3], {type: 'end', time: 5, distance: 300});
    assert.equal(scheduler.callbacks.size, 0);
    assert.equal(controller.handle(sample(6, 0, 0)), false);
}

{
    const {controller, events, scheduler} = createHarness();

    controller.handle(sample(10, 0, -1));
    const timeoutId = Array.from(scheduler.callbacks.keys())[0];

    scheduler.run(timeoutId);
    assert.deepEqual(events.at(-1), {
        type: 'end',
        time: 10,
        distance: 300,
    });
    assert.equal(controller.handle(sample(11, 0, 0)), false);
}

{
    const {controller, events, scheduler} = createHarness();

    controller.handle(sample(20, 0, -1));
    controller.destroy();
    assert.equal(scheduler.callbacks.size, 0);
    assert.equal(events.filter(event => event.type === 'end').length, 0);
    assert.equal(controller.handle(sample(21, 0, -1)), false);
}

console.log('nested scroll gesture tests passed');
