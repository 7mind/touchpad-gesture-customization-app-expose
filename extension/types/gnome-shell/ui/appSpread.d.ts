declare module 'resource:///org/gnome/shell/ui/searchController.js' {
    class SearchController {

        _shouldTriggerSearch?(): boolean;
    
}
}

declare module 'resource:///org/gnome/shell/ui/workspace.js' {
    import Meta from 'gi://Meta';

    class Workspace {

        _isOverviewWindow(window: Meta.Window): boolean;
    
}
}

declare module 'resource:///org/gnome/shell/ui/workspaceThumbnail.js' {
    import Meta from 'gi://Meta';

    class WorkspaceThumbnail {

        _isOverviewWindow(windowActor: Meta.WindowActor): boolean;
    
}
}
