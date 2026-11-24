const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function containImage(item, dx, dy) {
  function offset(start, size, delta) {
    if (size >= 1) return clamp(start + delta, 1 - size, 0) - start;
    return clamp(start + delta, 0, 1 - size) - start;
  }
  return { dx: offset(item.x, item.w, dx), dy: offset(item.y, item.h, dy) };
}

function fingers(touches) {
  const [a, b] = Array.from(touches);
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
    span: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
  };
}

export function zoomTarget(start, current) {
  return clamp(start.scale * current.span / Math.max(1, start.span), .12, 6);
}

export function bindPinch(stage, paper, { scale, zoom, finish, cancelDrag }) {
  let gesture;
  let frame;
  let pending;
  function paint() {
    frame = null;
    if (!pending) return;
    const { start, current } = pending;
    pending = null;
    zoom(zoomTarget(start, current));
    const box = paper.getBoundingClientRect();
    stage.scrollLeft += box.left + start.u * box.width - current.x;
    stage.scrollTop += box.top + start.v * box.height - current.y;
  }
  function handle(event) {
    if (event.touches.length < 2 || paper.hidden) return;
    if (event.cancelable) event.preventDefault();
    const current = fingers(event.touches);
    if (!gesture) {
      cancelDrag();
      const bounds = paper.getBoundingClientRect();
      gesture = {
        span: current.span, scale: scale(),
        u: clamp((current.x - bounds.left) / bounds.width, 0, 1),
        v: clamp((current.y - bounds.top) / bounds.height, 0, 1),
      };
      return;
    }
    pending = { start: gesture, current };
    if (frame === null || frame === undefined) frame = requestAnimationFrame(paint);
  }
  function stop(event) {
    if (!gesture || event.touches.length >= 2) return;
    if (frame !== null && frame !== undefined) cancelAnimationFrame(frame);
    paint();
    gesture = null;
    finish();
  }
  stage.addEventListener('touchstart', handle, { passive: false });
  stage.addEventListener('touchmove', handle, { passive: false });
  stage.addEventListener('touchend', stop);
  stage.addEventListener('touchcancel', stop);
  for (const type of ['gesturestart', 'gesturechange']) {
    stage.addEventListener(type, event => {
      if (!paper.hidden) event.preventDefault();
    }, { passive: false });
  }
}

export function resizeImage(item, corner, dx, dy, viewportWidth, viewportHeight) {
  const horizontal = corner.includes('w') ? -1 : 1;
  const vertical = corner.includes('n') ? -1 : 1;
  const anchorX = clamp(horizontal < 0 ? item.x + item.w : item.x, 0, 1);
  const anchorY = clamp(vertical < 0 ? item.y + item.h : item.y, 0, 1);
  const width = item.w * viewportWidth;
  const height = item.h * viewportHeight;
  const stretch = (horizontal * dx * viewportWidth * width + vertical * dy * viewportHeight * height)
    / (width * width + height * height);
  const availableX = horizontal < 0 ? anchorX : 1 - anchorX;
  const availableY = vertical < 0 ? anchorY : 1 - anchorY;
  const maximum = Math.min(availableX / item.w, availableY / item.h);
  if (!(maximum > 0) || !Number.isFinite(stretch)) return { dx: 0, dy: 0, widthRatio: 1, heightRatio: 1 };
  const minimum = Math.min(1, 16 / Math.max(width, height), maximum);
  const ratio = clamp(1 + stretch, minimum, maximum);
  const x = anchorX - (horizontal < 0 ? item.w * ratio : 0);
  const y = anchorY - (vertical < 0 ? item.h * ratio : 0);
  return { dx: x - item.x, dy: y - item.y, widthRatio: ratio, heightRatio: ratio };
}
