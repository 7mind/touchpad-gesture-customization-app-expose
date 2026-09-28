declare module 'resource:///org/gnome/shell/ui/windowPreview.js' {
    class WindowPreview {
        setStackAbove(preview: WindowPreview | null): void;

        _restack(): void;
    }
}
