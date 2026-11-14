// jsdom leaves out a few browser APIs that Radix UI calls when a menu opens.
const element = Element.prototype;
element.hasPointerCapture ??= () => false;
element.setPointerCapture ??= () => {};
element.releasePointerCapture ??= () => {};
element.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
