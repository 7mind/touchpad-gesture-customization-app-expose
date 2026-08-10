export type OverviewWindowFilter<TWindow> = (window: TWindow) => boolean;

export type ApplicationOverviewWindow = {
    skip_taskbar: boolean;
};

export function shouldShowInApplicationOverview<
    TWindow extends ApplicationOverviewWindow,
>(
    window: TWindow,
    isApplicationWindow: OverviewWindowFilter<TWindow>
): boolean {
    return !window.skip_taskbar && isApplicationWindow(window);
}
