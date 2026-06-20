{
  config,
  lib,
  ...
}:
{
  imports = [
    # inputs.uriel.nixosModules.uriel-worker
  ];

  services.uriel-worker = {
    enable = true;
    environmentFiles = [
      "/run/secrets/uriel-worker.env"
    ];

    # Optional QA knobs.
    browserUrl = "http://127.0.0.1:3000";
    androidAvd = "uriel-api-35";

    extraEnvironment = {
      URIEL_ADAPTER_ISSUE_TRACKER = "linear";
      URIEL_ADAPTER_LINEAR_TEAM_KEY = "APP";
      URIEL_ADAPTER_LINEAR_IN_PROGRESS_STATE = "In Progress";
      URIEL_ADAPTER_REPO_BOOTSTRAP = "direnv";
    };
  };
}
