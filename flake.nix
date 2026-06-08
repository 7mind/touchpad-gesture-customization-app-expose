{
  description = "Touchpad Gesture Customization GNOME Shell extension (7mind fork with app-expose support)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        package = pkgs.callPackage ./package.nix { src = self; };
      in
      {
        packages.default = package;
        packages.gnome-shell-extension-touchpad-gesture-customization-app-expose = package;
      });
}
