export type NestedScrollSample = {
    time: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
};

export type NestedScrollDirection = 'smooth' | 'up' | 'down' | 'left' | 'right';

export type NestedScrollInput = NestedScrollSample & {
    direction: NestedScrollDirection;
};

export type NestedScrollScheduler = {
    schedule(delay: number, callback: () => void): number;
    cancel(id: number): void;
};

export type NestedScrollGestureOptions = {
    distance: number;
    multiplier: number;
    endDelayMs: number;
    scheduler: NestedScrollScheduler;
    begin(time: number, x: number, y: number): void;
    update(time: number, delta: number, distance: number): void;
    end(time: number, distance: number): void;
};

export function normalizeNestedScrollSample(
    input: NestedScrollInput
): NestedScrollSample | null {
    const {time, x, y, dx, dy, direction} = input;

    switch (direction) {
        case 'smooth':
            return {time, x, y, dx, dy};
        case 'up':
            return {time, x, y, dx: 0, dy: -1};
        case 'down':
            return {time, x, y, dx: 0, dy: 1};
        case 'left':
        case 'right':
            return null;
    }
}

export class NestedScrollGestureController {
    private readonly _options: NestedScrollGestureOptions;
    private _active = false;
    private _destroyed = false;
    private _lastTime = 0;
    private _timeoutId: number | null = null;

    constructor(options: NestedScrollGestureOptions) {
        this._options = options;
    }

    handle(sample: NestedScrollSample): boolean {
        if (this._destroyed) return false;

        if (!this._active) {
            if (sample.dx === 0 && sample.dy === 0) return false;
            if (Math.abs(sample.dy) < Math.abs(sample.dx)) return false;

            this._active = true;
            this._options.begin(sample.time, sample.x, sample.y);
        }

        if (sample.dx === 0 && sample.dy === 0) {
            this._finish(sample.time);
            return true;
        }

        this._lastTime = sample.time;
        this._options.update(
            sample.time,
            sample.dy * this._options.multiplier,
            this._options.distance
        );
        this._rescheduleEnd();
        return true;
    }

    destroy(): void {
        if (this._destroyed) return;

        this._destroyed = true;
        this._active = false;
        this._cancelEnd();
    }

    private _rescheduleEnd(): void {
        this._cancelEnd();
        this._timeoutId = this._options.scheduler.schedule(
            this._options.endDelayMs,
            () => {
                this._timeoutId = null;
                this._finish(this._lastTime);
            }
        );
    }

    private _finish(time: number): void {
        if (!this._active) return;

        this._active = false;
        this._cancelEnd();
        this._options.end(time, this._options.distance);
    }

    private _cancelEnd(): void {
        if (this._timeoutId === null) return;

        this._options.scheduler.cancel(this._timeoutId);
        this._timeoutId = null;
    }
}
