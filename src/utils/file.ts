import { readFile } from "node:fs/promises";

export const readFileContent = async (filePath: string): Promise<string> => {
  return readFile(filePath, "utf-8");
};
