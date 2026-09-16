import { inferStemRole, type StemRole } from "../model/Project";
import { hasLeadingStemNumber } from "./importOrdering";

export function inferNewAudioImportRole(fileName: string): StemRole {
  if (!hasLeadingStemNumber(fileName)) return "reference";
  return inferStemRole(fileName);
}
