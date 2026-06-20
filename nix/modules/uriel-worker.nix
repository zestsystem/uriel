self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.uriel-worker;

  opencodeWrapper = pkgs.writeShellScriptBin "opencode" ''
    exec ${pkgs.nodejs_22}/bin/npx --yes opencode-ai "$@"
  '';

  androidSdk = pkgs.androidenv.composeAndroidPackages {
    cmdLineToolsVersion = "11.0";
    platformToolsVersion = "36.0.0";
    buildToolsVersions = [
      "36.0.0"
      "35.0.0"
    ];
    platformVersions = [
      "36"
      "35"
    ];
    includeEmulator = true;
    includeNDK = true;
    ndkVersions = [ "27.1.12297006" ];
  };

  runtimePath =
    with pkgs;
    [
      bash
      coreutils
      curl
      direnv
      ffmpeg
      gh
      git
      git-lfs
      jq
      just
      nix
      nodejs_22
      pnpm
      rsync
      android-tools
      chromium
      opencodeWrapper
    ]
    ++ lib.optionals (pkgs ? maestro) [ pkgs.maestro ]
    ++ [ androidSdk.androidsdk ];
in
{
  options.services.uriel-worker = {
    enable = lib.mkEnableOption "Uriel NixOS remote coding worker";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.system}.uriel-worker;
      description = "Package providing the uriel-worker executable.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "uriel";
      description = "System user that runs the worker.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "uriel";
      description = "System group that owns worker state.";
    };

    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/uriel";
      description = "Worker state directory.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Worker bind host.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8788;
      description = "Worker bind port.";
    };

    environmentFiles = lib.mkOption {
      type = lib.types.listOf lib.types.path;
      default = [ ];
      description = ''
        Environment files consumed by systemd before starting the worker.
        Use this with NixOS-native secret tools such as sops-nix or agenix.
        Files should contain KEY=VALUE lines such as URIEL_WORKER_TOKEN=...
      '';
    };

    browserUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional URL for browser QA smoke captures.";
    };

    androidAvd = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional Android AVD name to boot before Android QA.";
    };

    extraEnvironment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Additional environment variables for the worker.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.groups.${cfg.group} = { };
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = cfg.stateDir;
      createHome = true;
      extraGroups = [
        "adbusers"
        "kvm"
        "render"
        "video"
      ];
    };

    programs.adb.enable = true;
    users.groups.adbusers = { };
    services.udev.packages = lib.optionals (pkgs ? android-udev-rules) [
      pkgs.android-udev-rules
    ];

    nix.settings = {
      experimental-features = [
        "nix-command"
        "flakes"
      ];
      trusted-users = [ cfg.user ];
    };

    systemd.tmpfiles.rules = [
      "d ${toString cfg.stateDir} 0750 ${cfg.user} ${cfg.group} - -"
      "d ${toString cfg.stateDir}/repos 0750 ${cfg.user} ${cfg.group} - -"
      "d ${toString cfg.stateDir}/worktrees 0750 ${cfg.user} ${cfg.group} - -"
      "d ${toString cfg.stateDir}/artifacts 0750 ${cfg.user} ${cfg.group} - -"
    ];

    systemd.services.uriel-worker = {
      description = "Uriel remote NixOS coding worker";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      path = runtimePath;
      environment = {
        ANDROID_HOME = "${androidSdk.androidsdk}/libexec/android-sdk";
        ANDROID_SDK_ROOT = "${androidSdk.androidsdk}/libexec/android-sdk";
        URIEL_STATE_DIR = toString cfg.stateDir;
        URIEL_WORKER_HOST = cfg.host;
        URIEL_WORKER_PORT = toString cfg.port;
      }
      // lib.optionalAttrs (cfg.browserUrl != null) {
        URIEL_BROWSER_URL = cfg.browserUrl;
      }
      // lib.optionalAttrs (cfg.androidAvd != null) {
        URIEL_ANDROID_AVD = cfg.androidAvd;
      }
      // cfg.extraEnvironment;
      serviceConfig = {
        ExecStart = "${cfg.package}/bin/uriel-worker serve --host ${cfg.host} --port ${toString cfg.port}";
        Group = cfg.group;
        Restart = "on-failure";
        RestartSec = "10s";
        StateDirectory = "uriel";
        User = cfg.user;
        WorkingDirectory = cfg.stateDir;
      }
      // lib.optionalAttrs (cfg.environmentFiles != [ ]) {
        EnvironmentFile = cfg.environmentFiles;
      };
    };
  };
}
