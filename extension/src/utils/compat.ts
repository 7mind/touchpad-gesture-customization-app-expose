/* eslint-disable @typescript-eslint/no-explicit-any */
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SwipeTracker} from 'resource:///org/gnome/shell/ui/swipeTracker.js';

// GNOME version compatibility shims.
//
// Between GNOME 48 and 49 the Shell/Mutter APIs this extension relies on were
// renamed or replaced. To support GNOME 48 alongside 49/50 from a single
// codebase we feature-detect the runtime shape instead of hard-coding a
// version number, which also tolerates point releases and backports.

// GNOME 49 renamed SwipeTracker's internal touchpad gesture handlers
// (_beginGesture -> _beginTouchpadGesture, etc.) and added the `phase`
// constructor option. Both land together, so one probe gates both.
export const HAS_TOUCHPAD_GESTURE_METHODS =
    '_beginTouchpadGesture' in SwipeTracker.prototype;

type GestureHandler = (...args: any[]) => void;

/**
 * Resolve and bind SwipeTracker's internal touchpad gesture handlers, which
 * were renamed in GNOME 49 (_beginGesture -> _beginTouchpadGesture, ...).
 *
 * @param swipeTracker the SwipeTracker whose handlers should be bound
 */
export function bindTouchpadHandlers(
    swipeTracker: typeof SwipeTracker.prototype
): {
    begin: GestureHandler;
    update: GestureHandler;
    end: GestureHandler;
} {
    const begin =
        swipeTracker._beginTouchpadGesture ?? swipeTracker._beginGesture;
    const update =
        swipeTracker._updateTouchpadGesture ?? swipeTracker._updateGesture;
    const end = swipeTracker._endTouchpadGesture ?? swipeTracker._endGesture;

    if (!begin || !update || !end)
        throw new Error('SwipeTracker touchpad gesture handlers not found');

    return {
        begin: begin.bind(swipeTracker),
        update: update.bind(swipeTracker),
        end: end.bind(swipeTracker),
    };
}

/**
 * Show an on-screen display across GNOME versions. GNOME 49 replaced
 * osdWindowManager.show(monitorIndex, icon, label, level) with
 * showAll(icon, label, level, maxLevel), adding overamplification support via
 * maxLevel. On GNOME 48 maxLevel has no effect (the OSD clamps at 100%).
 *
 * @param icon the icon to display
 * @param label optional label
 * @param level the fill level
 * @param maxLevel the maximum level (GNOME 49+ only)
 */
export function showOsd(
    icon: Gio.Icon,
    label: string | null,
    level: number,
    maxLevel: number
): void {
    const osd = Main.osdWindowManager;
    if (typeof osd.showAll === 'function')
        osd.showAll(icon, label, level, maxLevel);
    else if (typeof osd.show === 'function') osd.show(-1, icon, label, level); // -1: all monitors
}

// GNOME 49 replaced Meta.Window.get_maximized()/maximize(flags)/
// unmaximize(flags) with is_maximized()/maximize()/unmaximize() (no-arg,
// always operating on both directions).

/**
 * @param window the window to query
 */
export function isWindowMaximized(window: Meta.Window): boolean {
    if (typeof (window as any).is_maximized === 'function')
        return (window as any).is_maximized();
    return (window as any).get_maximized() === Meta.MaximizeFlags.BOTH;
}

/**
 * @param window the window to maximize
 */
export function maximizeWindow(window: Meta.Window): void {
    if (typeof (window as any).is_maximized === 'function')
        (window as any).maximize();
    else (window as any).maximize(Meta.MaximizeFlags.BOTH);
}

/**
 * @param window the window to unmaximize
 */
export function unmaximizeWindow(window: Meta.Window): void {
    if (typeof (window as any).is_maximized === 'function')
        (window as any).unmaximize();
    else (window as any).unmaximize(Meta.MaximizeFlags.BOTH);
}
