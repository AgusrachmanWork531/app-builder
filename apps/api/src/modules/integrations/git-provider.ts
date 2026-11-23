export interface GitFile {
  /** Repository-relative path. */
  path: string;
  content: Buffer;
}

export interface GitCommitResult {
  repository: string;
  commitSha: string;
  files: number;
}

/**
 * Git provider boundary. Only a platform-owned local repository adapter
 * exists. Remote providers (GitHub/GitLab) must take credentials from a
 * secret store (never from generated code) and require an explicit approval
 * before modifying an existing repository — see docs/security.
 */
export interface GitProvider {
  readonly name: string;
  commitFiles(repository: string, files: GitFile[], message: string): Promise<GitCommitResult>;
}

export const GIT_PROVIDER = Symbol('GIT_PROVIDER');
