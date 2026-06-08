# Build of this GNOME Shell extension. The flake passes `src = self`, so the
# source is pinned by the consumer's flake.lock and needs no maintenance here.
# When package-lock.json changes, refresh npmDepsHash below with ./update-flake-deps.sh.
{ lib
, buildNpmPackage
, glib
, src ? lib.cleanSource ./.
, ...
}:

buildNpmPackage {
  pname = "gnome-shell-extension-touchpad-gesture-customization-app-expose";
  version = "0-unstable-2026-06-02";

  uuid = "touchpad-gesture-customization@coooolapps.com";

  inherit src;

  npmDepsHash = "sha256-aAuXYDDuKwHqCtEXJkEetPhp4OxRFPxcxRXJLWSTJzM=";

  nativeBuildInputs = [ glib ];

  postBuild = ''
    cp -r extension/assets extension/stylesheet.css extension/ui extension/schemas metadata.json build/
    if [ -d build/schemas ]; then
      glib-compile-schemas --strict build/schemas
    fi
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/gnome-shell/extensions
    cp -r -T build $out/share/gnome-shell/extensions/touchpad-gesture-customization@coooolapps.com
    runHook postInstall
  '';

  meta = {
    description = "Touchpad Gesture Customization GNOME Shell extension (7mind fork with app-expose support)";
    homepage = "https://github.com/7mind/touchpad-gesture-customization-app-expose";
    license = lib.licenses.lgpl3Plus;
    platforms = lib.platforms.linux;
  };

  passthru = {
    extensionPortalSlug = "touchpad-gesture-customization";
    extensionUuid = "touchpad-gesture-customization@coooolapps.com";
  };
}
