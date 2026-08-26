export type ApplicationGroupedOverviewAvailability = {
    supported: boolean;
    enabled: boolean;
};

const MINIMUM_SUPPORTED_SHELL_MAJOR_VERSION = 50;
const SHELL_VERSION_PATTERN = /^(\d+)(?:\.|$)/;

export function resolveApplicationGroupedOverviewAvailability(
    shellVersion: string,
    configured: boolean
): ApplicationGroupedOverviewAvailability {
    const match = SHELL_VERSION_PATTERN.exec(shellVersion);
    const shellMajorVersion =
        match === null ? null : Number.parseInt(match[1], 10);
    const supported =
        shellMajorVersion !== null &&
        shellMajorVersion >= MINIMUM_SUPPORTED_SHELL_MAJOR_VERSION;

    return {supported, enabled: supported && configured};
}
