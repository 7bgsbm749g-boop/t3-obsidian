import 'obsidian';
export {};
declare global {
  /** Obsidian installs its DOM factories in each workspace window. The SDK
   * currently declares the global functions but omits them from Document.win. */
  interface Window {
    createEl:typeof createEl;
    createDiv:typeof createDiv;
    createSpan:typeof createSpan;
    createSvg:typeof createSvg;
  }
}
