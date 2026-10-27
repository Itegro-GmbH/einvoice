#!/bin/sh
# Installs the veraPDF greenfield CLI locally into tools/verapdf/ (nothing global, git-ignored).
# Java 11+ is required. veraPDF is only used by the test suite (PDF/A-3B validation), never at runtime.
# Usage: npm run setup:verapdf   ->   ./tools/verapdf/verapdf --version
set -eu
VER=1.30.2
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/tools"
mkdir -p "$DIR"
cd "$DIR"
[ -x verapdf/verapdf ] && { echo "veraPDF already installed: $DIR/verapdf"; exit 0; }
curl -fL --max-time 240 -o verapdf-installer.zip "https://software.verapdf.org/releases/${VER%.*}/verapdf-greenfield-${VER}-installer.zip"
unzip -o -q verapdf-installer.zip
cat > verapdf-auto-install.xml <<XML
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
    <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
    <com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>$DIR/verapdf</installpath></com.izforge.izpack.panels.target.TargetPanel>
    <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
        <pack index="0" name="veraPDF GUI" selected="true"/>
        <pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/>
        <pack index="2" name="veraPDF Validation model" selected="false"/>
        <pack index="3" name="veraPDF Documentation" selected="false"/>
        <pack index="4" name="veraPDF Sample Plugins" selected="false"/>
    </com.izforge.izpack.panels.packs.PacksPanel>
    <com.izforge.izpack.panels.install.InstallPanel id="install"/>
    <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
XML
java -jar "verapdf-greenfield-${VER}/verapdf-izpack-installer-${VER}.jar" verapdf-auto-install.xml
rm -rf "verapdf-greenfield-${VER}" verapdf-installer.zip verapdf-auto-install.xml
./verapdf/verapdf --version | head -1
