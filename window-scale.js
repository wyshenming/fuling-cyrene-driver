'use strict';

const DESIGN_WIDTH = 1180;
const DESIGN_HEIGHT = 760;

function calculateWindowScale(width, height) {
  return Math.max(0.65, Math.min(2.5, Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT)));
}

function fitWindowScale(window) {
  if (!window || window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  window.webContents.setZoomFactor(calculateWindowScale(width, height));
}

module.exports = { DESIGN_WIDTH, DESIGN_HEIGHT, calculateWindowScale, fitWindowScale };
