document.querySelectorAll('.copy-button').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied';
      window.setTimeout(() => { button.textContent = 'Copy'; }, 1600);
    } catch {
      button.textContent = 'Select command';
    }
  });
});

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

document.querySelectorAll('[data-ascii-field]').forEach((canvas, fieldIndex) => {
  const context = canvas.getContext('2d');
  const container = canvas.parentElement;
  const glyphs = ['{', '}', '/', ':', '·', '→', '[', ']', '+', '|'];
  const seed = 2718 + fieldIndex * 97;
  let cells = [];
  let width = 0;
  let height = 0;
  let pointer = { x: -1000, y: -1000, active: false };
  let frame = 0;
  let previousTime = 0;

  const randomFor = (value) => {
    const result = Math.sin(value * 12.9898 + seed * 78.233) * 43758.5453;
    return result - Math.floor(result);
  };

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const gapX = width < 700 ? 28 : 34;
    const gapY = 28;
    cells = [];
    let index = 0;
    for (let y = 18; y < height; y += gapY) {
      for (let x = 12; x < width; x += gapX) {
        if (randomFor(index + 2) > .48) {
          cells.push({
            x,
            y,
            char: glyphs[Math.floor(randomFor(index + 8) * glyphs.length)],
            phase: randomFor(index + 14) * Math.PI * 2,
            alpha: .045 + randomFor(index + 21) * .085,
          });
        }
        index += 1;
      }
    }
  };

  const draw = (time = 0) => {
    if (time - previousTime < 42 && !motionQuery.matches) {
      frame = requestAnimationFrame(draw);
      return;
    }
    previousTime = time;
    context.clearRect(0, 0, width, height);
    context.font = '11px "SFMono-Regular", Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const seconds = motionQuery.matches ? 0 : time * .00016;
    for (const cell of cells) {
      const distance = Math.hypot(cell.x - pointer.x, cell.y - pointer.y);
      const influence = pointer.active ? Math.max(0, 1 - distance / 145) : 0;
      const drift = Math.sin(seconds + cell.phase) * (1.2 + influence * 2.5);
      const alpha = Math.min(.34, cell.alpha + influence * .21);
      context.fillStyle = `rgba(167, 139, 250, ${alpha})`;
      context.fillText(influence > .52 && cell.char === '·' ? '→' : cell.char, cell.x + drift, cell.y + Math.cos(seconds * .7 + cell.phase) * .8);
    }
    if (!motionQuery.matches) frame = requestAnimationFrame(draw);
  };

  const updatePointer = (event) => {
    const rect = container.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true };
  };

  container.addEventListener('pointermove', updatePointer, { passive: true });
  container.addEventListener('pointerleave', () => { pointer.active = false; });
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  draw();
  motionQuery.addEventListener('change', () => {
    cancelAnimationFrame(frame);
    draw();
  });
});
