export const NOTEBOOK_TYPE = "notebook";
export const NOTEBOOK_SOURCE = "notebook-source";
export function checkNotebookType(before: string, after = before) {
  if (before !== after && (before === NOTEBOOK_TYPE || after === NOTEBOOK_TYPE)) {
    throw new Error("Documents and notebooks cannot be converted. Create a separate notebook instead.");
  }
}
