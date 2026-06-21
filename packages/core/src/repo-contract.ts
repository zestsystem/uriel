export interface RepoContract {
  agentsFile?: string;
  hasFlake: boolean;
  hasJustfile: boolean;
  justRecipes: string[];
  preferredCommands: string[];
}

export function createRepoContract(input: {
  agentsFile?: string;
  hasFlake?: boolean;
  hasJustfile?: boolean;
  justRecipes?: string[];
} = {}): RepoContract {
  const contract = {
    agentsFile: input.agentsFile,
    hasFlake: input.hasFlake ?? false,
    hasJustfile: input.hasJustfile ?? false,
    justRecipes: [...new Set(input.justRecipes ?? [])].sort(),
    preferredCommands: []
  };
  return {
    ...contract,
    preferredCommands: inferPreferredCommands(contract)
  };
}

export function inferPreferredCommands(
  contract: Pick<RepoContract, "hasFlake" | "hasJustfile" | "justRecipes">
): string[] {
  const commands: string[] = [];
  if (contract.hasFlake) {
    commands.push("nix flake check");
  }

  if (contract.hasJustfile) {
    for (const recipe of ["qa", "check", "test", "lint", "qa-browser", "qa-android"]) {
      if (contract.justRecipes.includes(recipe)) {
        commands.push(`just ${recipe}`);
      }
    }
  }

  return commands;
}

export function parseJustRecipes(output: string): string[] {
  const recipes = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    const recipe = /^\s{4}([a-zA-Z0-9][a-zA-Z0-9_.:-]*)\b/u.exec(line)?.[1];
    if (recipe) {
      recipes.add(recipe);
    }
  }
  return [...recipes].sort();
}
