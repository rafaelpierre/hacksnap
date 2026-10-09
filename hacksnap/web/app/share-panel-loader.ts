/** Load the dialog controller only after a reader opens a share control. */
export function loadSharePanel() {
  return import("./share-panel");
}
