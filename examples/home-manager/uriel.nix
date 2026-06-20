{
  imports = [
    # inputs.uriel.homeManagerModules.uriel
  ];

  programs.uriel = {
    enable = true;
    installOpenCodeWrapper = true;
  };
}
