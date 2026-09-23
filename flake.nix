{
  description = "Touchpad Gesture Customization GNOME Shell extension (7mind fork with app-expose support)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs-gnome-48.url = "github:NixOS/nixpkgs/nixos-25.05";
    nixpkgs-gnome-49.url = "github:NixOS/nixpkgs/nixos-25.11";
    nixpkgs-gnome-50.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-gnome-48,
      nixpkgs-gnome-49,
      nixpkgs-gnome-50,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        package = pkgs.callPackage ./package.nix { src = self; };
        extensionUuid = "touchpad-gesture-customization@coooolapps.com";
        mkNestedGnome =
          input: shellMajorVersion: presentationMode:
          let
            targetPkgs = input.legacyPackages.${system};
            targetExtension = targetPkgs.callPackage ./package.nix { src = self; };
            launcher = targetPkgs.callPackage ./nix/nested-gnome.nix {
              extension = targetExtension;
              xdpyinfo = targetPkgs.xdpyinfo or targetPkgs.xorg.xdpyinfo;
              inherit extensionUuid presentationMode shellMajorVersion;
            };
            check = targetPkgs.callPackage ./nix/nested-gnome-check.nix {
              extension = targetExtension;
              presentationOption = if presentationMode == "mutter-devkit" then "--devkit" else "--nested";
              inherit extensionUuid launcher shellMajorVersion;
            };
          in
          {
            inherit launcher check;
          };
        nestedGnome48 = mkNestedGnome nixpkgs-gnome-48 "48" "nested-x11";
        nestedGnome49 = mkNestedGnome nixpkgs-gnome-49 "49" "mutter-devkit";
        nestedGnome50 = mkNestedGnome nixpkgs-gnome-50 "50" "mutter-devkit";
        mkNestedGnomeApp = shellMajorVersion: launcher: {
          type = "app";
          program = "${launcher}/bin/nested-gnome-${shellMajorVersion}";
          meta.description = "Run an isolated nested GNOME ${shellMajorVersion} test session";
        };
      in
      {
        packages = {
          default = package;
          gnome-shell-extension-touchpad-gesture-customization-app-expose = package;
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          nested-gnome-48 = nestedGnome48.launcher;
          nested-gnome-49 = nestedGnome49.launcher;
          nested-gnome-50 = nestedGnome50.launcher;
        };

        apps = pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          gnome-48 = mkNestedGnomeApp "48" nestedGnome48.launcher;
          gnome-49 = mkNestedGnomeApp "49" nestedGnome49.launcher;
          gnome-50 = mkNestedGnomeApp "50" nestedGnome50.launcher;
        };

        checks = pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          nested-gnome-48 = nestedGnome48.check;
          nested-gnome-49 = nestedGnome49.check;
          nested-gnome-50 = nestedGnome50.check;
        };
      }
    );
}
