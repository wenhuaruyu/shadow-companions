// Keep a landscape canvas when the phone turns, without recreating game state.
export function fitLandscapeStage(stage, minimumWidth = 600, minimumHeight = 280) {
  function fit() {
    const viewport = window.visualViewport;
    const width = viewport?.width || innerWidth;
    const height = viewport?.height || innerHeight;
    const stageWidth = Math.max(minimumWidth, width, height);
    const stageHeight = Math.max(minimumHeight, Math.min(width, height));
    const scale = Math.min(width / stageWidth, height / stageHeight);
    Object.assign(stage.style, {
      width: `${stageWidth}px`,
      height: `${stageHeight}px`,
      left: `${(width - stageWidth * scale) / 2 + (viewport?.offsetLeft || 0)}px`,
      top: `${(height - stageHeight * scale) / 2 + (viewport?.offsetTop || 0)}px`,
      transform: `scale(${scale})`,
    });
    stage.classList.toggle('compact', stageHeight < 360);
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  window.visualViewport?.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('scroll', fit);
  fit();
}
