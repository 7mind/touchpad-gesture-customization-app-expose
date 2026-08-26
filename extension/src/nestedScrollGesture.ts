import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {SwipeTracker} from 'resource:///org/gnome/shell/ui/swipeTracker.js';
import {NestedScrollGestureController} from '../common/nestedScrollGesture.js';
import {TouchpadConstants} from '../constants.js';
import {bindTouchpadHandlers} from './utils/compat.js';

const NESTED_SCROLL_END_DELAY_MS = 250;
const NESTED_SCROLL_MULTIPLIER = 10;

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
        this._signalId = actor.connect('scroll-event', (_actor, event) => {
            const [dx, dy] = event.get_scroll_delta();
            const [x, y] = event.get_coords();
            const handled = this._controller.handle({
                time: event.get_time(),
                x,
                y,
                dx,
                dy,
                smooth:
                    event.get_scroll_direction() ===
                    Clutter.ScrollDirection.SMOOTH,
            });

            return handled ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
    }

    destroy(): void {
        this._actor.disconnect(this._signalId);
        this._controller.destroy();
    }
}
