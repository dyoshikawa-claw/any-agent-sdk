import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

export type SetupTestDirectoryOptions = {
  home?: boolean;
};

export type SetupTestDirectoryResult = {
  testDir: string;
  cleanup: () => Promise<void>;
};

export const setupTestDirectory = async (
  options: SetupTestDirectoryOptions = {},
): Promise<SetupTestDirectoryResult> => {
  const bucket = options.home ? "home" : "projects";
  const testDir = join(process.cwd(), "tmp", "tests", bucket, randomUUID());

  await mkdir(testDir, { recursive: true });

  return {
    testDir,
    cleanup: async () => {
      await rm(testDir, { recursive: true, force: true });
    },
  };
};
