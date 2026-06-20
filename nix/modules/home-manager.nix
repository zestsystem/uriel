self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.uriel;
  opencodeWrapper = pkgs.writeShellScriptBin "opencode" ''
    exec ${pkgs.nodejs_22}/bin/npx --yes opencode-ai "$@"
  '';
in
{
  options.programs.uriel = {
    enable = lib.mkEnableOption "Uriel user tools";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.system}.urielctl;
      description = "Package providing urielctl.";
    };

    installOpenCodeWrapper = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Install an opencode wrapper backed by npx opencode-ai.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages =
      with pkgs;
      [
        cfg.package
        self.packages.${pkgs.system}.uriel-worker
        direnv
        ffmpeg
        gh
        git
        git-lfs
        jq
        just
        nodejs_22
        pnpm
        android-tools
        chromium
      ]
      ++ lib.optionals cfg.installOpenCodeWrapper [ opencodeWrapper ];
  };
}
