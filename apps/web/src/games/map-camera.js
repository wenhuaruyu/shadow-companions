export function updateMapCamera(canvas, position, cellSize, topInset = 0) {
  const height = canvas.parentElement.clientHeight - topInset;
  const scale = canvas.clientWidth / canvas.width;
  const worldHeight = canvas.height * scale;
  const target = (position[1] + 0.5) * cellSize * scale - height / 2;
  const offset = Math.max(0, Math.min(Math.max(0, worldHeight - height), target));
  canvas.style.transform = `translateY(${-offset}px)`;
}

// Full-map views may have letterboxing around the original map.
export function mapPoint(canvas, event, columns, rows) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const contained = getComputedStyle(canvas).objectFit === 'contain';
  const width = contained ? canvas.width * scale : rect.width;
  const height = contained ? canvas.height * scale : rect.height;
  const left = rect.left + (rect.width - width) / 2;
  const top = rect.top + (rect.height - height) / 2;
  return [
    Math.max(0, Math.min(columns - 1, Math.floor((event.clientX - left) / width * columns))),
    Math.max(0, Math.min(rows - 1, Math.floor((event.clientY - top) / height * rows))),
  ];
}
