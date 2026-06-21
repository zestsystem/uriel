{
  config,
  lib,
  pkgs,
  ...
}:
{
  imports = [
    # inputs.uriel.nixosModules.uriel-worker
  ];

  services.uriel-worker = {
    enable = true;
    allowedRepos = [ "zestsystem/uriel" ];
    maxConcurrentJobs = 1;
    artifactRetentionDays = 14;
    environmentFiles = [
      "/run/secrets/uriel-worker.env"
    ];

    # Optional QA knobs.
    enableBrowserQa = true;
    browserUrl = "http://127.0.0.1:3000";
    enableAndroidQa = true;
    androidAvd = "uriel-api-35";

    extraEnvironment = {
      URIEL_ADAPTER_REPO_BOOTSTRAP = "direnv";
    };

    extraPackages = [
      pkgs.ripgrep
    ];
  };
}
