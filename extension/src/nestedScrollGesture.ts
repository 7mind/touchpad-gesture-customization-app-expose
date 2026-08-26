import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {SwipeTracker} from 'resource:///org/gnome/shell/ui/swipeTracker.js';
import {
    NestedScrollGestureController,
    normalizeNestedScrollSample,
    type NestedScrollDirection,
} from '../common/nestedScrollGesture.js';
import {TouchpadConstants} from '../constants.js';
import {bindTouchpadHandlers} from './utils/compat.js';

const NESTED_SCROLL_END_DELAY_MS = 250;
const NESTED_SCROLL_MULTIPLIER = 10;

function getNestedScrollDirection(
    direction: Clutter.ScrollDirection
): NestedScrollDirection | null {
    switch (direction) {
        case Clutter.ScrollDirection.SMOOTH:
            return 'smooth';
        case Clutter.ScrollDirection.UP:
            return 'up';
        case Clutter.ScrollDirection.DOWN:
            return 'down';
        case Clutter.ScrollDirection.LEFT:
            return 'left';
        case Clutter.ScrollDirection.RIGHT:
            return 'right';
        default:
            return null;
    }
}

export class NestedScrollGesture {
    private readonly _actor: Clutter.Actor;
    private readonly _controller: NestedScrollGestureController;
    private readonly _signalId: number;

    constructor(
        actor: Clutter.Actor,
        swipeTracker: typeof SwipeTracker.prototype
    ) {
        this._actor = actor;
        const handlers = bindTouchpadHandlers(swipeTracker);

        this._controller = new NestedScrollGestureController({
            distance: TouchpadConstants.TOUCHPAD_BASE_HEIGHT,
            multiplier: NESTED_SCROLL_MULTIPLIER,
            endDelayMs: NESTED_SCROLL_END_DELAY_MS,
            scheduler: {
                schedule: (delay, callback) =>
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                        callback();
                        return GLib.SOURCE_REMOVE;
                    }),
                cancel: id => GLib.source_remove(id),
            },
            begin: (time, x, y) => handlers.begin(this, time, x, y),
            update: (time, delta, distance) =>
                handlers.update(this, time, delta, distance),
            end: (time, distance) => handlers.end(this, time, distance),
        });
        this._signalId = actor.connect(
            'captured-event::scroll',
            (_actor, event) => {
                const direction = getNestedScrollDirection(
                    event.get_scroll_direction()
                );

                if (direction === null) return Clutter.EVENT_PROPAGATE;

                let dx = 0;
                let dy = 0;

                if (direction === 'smooth') [dx, dy] = event.get_scroll_delta();

                const [x, y] = event.get_coords();
                const sample = normalizeNestedScrollSample({
                    time: event.get_time(),
                    x,
                    y,
                    dx,
                    dy,
                    direction,
                });

                if (sample === null) return Clutter.EVENT_PROPAGATE;

                const handled = this._controller.handle(sample);

                return handled ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
            }
        );
    }

    destroy(): void {
        this._actor.disconnect(this._signalId);
        this._controller.destroy();
    }
}
