// Gráficas SVG ligeras para el panel de administración (sin dependencias).
// Global compartido con admin.js.
// eslint-disable-next-line no-unused-vars
const AdminCharts = (() => {
  const HEIGHT = 220;
  const PAD = { top: 14, right: 8, bottom: 28, left: 40 };
  const numberFormat = new Intl.NumberFormat('es-MX');
  const dayFormat = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const longDayFormat = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const observers = new WeakMap();

  function parseDay(day) {
    const [year, month, date] = String(day).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, date));
  }

  // Escala con marcas enteras y redondas (1, 2, 5 × 10ⁿ) y como máximo 5 divisiones.
  function niceScale(value) {
    const rough = Math.max(value, 4) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough && Number.isInteger(s)) || Math.ceil(rough);
    const max = Math.ceil(Math.max(value, 1) / step) * step;
    const ticks = [];
    for (let tick = 0; tick <= max; tick += step) ticks.push(tick);
    return { max, ticks };
  }

  // Barra con esquinas superiores redondeadas y base plana sobre el eje.
  function barPath(x, y, width, height) {
    const r = Math.min(4, width / 2, height);
    return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
  }

  function accessibleTable(title, labels, values) {
    const rows = labels.map((label, i) => `<tr><td>${escapeHtml(longDayFormat.format(parseDay(label)))}</td><td>${values[i]}</td></tr>`).join('');
    return `<table class="sr-only"><caption>${escapeHtml(title)}</caption><thead><tr><th>Día</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderBars(container, options) {
    const { labels, values, color, title, unit } = options;
    const width = Math.max(container.clientWidth || 0, 280);
    const plotW = width - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const { max, ticks } = niceScale(Math.max(0, ...values));
    const step = plotW / Math.max(values.length, 1);
    const barW = Math.max(2, Math.min(28, step - 2));
    const yFor = (value) => PAD.top + plotH - (value / max) * plotH;

    const grid = ticks.map((tick) => {
      const y = yFor(tick);
      return `<line class="${tick === 0 ? 'baseline' : 'grid-line'}" x1="${PAD.left}" x2="${width - PAD.right}" y1="${y}" y2="${y}"/>`
        + `<text class="axis-label" x="${PAD.left - 8}" y="${y + 4}" text-anchor="end">${numberFormat.format(tick)}</text>`;
    }).join('');

    // Etiquetas espaciadas de forma uniforme contando desde el último día (siempre visible).
    const labelEvery = Math.ceil(values.length / Math.max(2, Math.floor(plotW / 64)));
    const last = values.length - 1;
    const bars = values.map((value, i) => {
      const cx = PAD.left + step * i + step / 2;
      const x = cx - barW / 2;
      const h = (value / max) * plotH;
      const bar = h > 0
        ? `<path class="bar" data-index="${i}" d="${barPath(x, PAD.top + plotH - h, barW, h)}" fill="${color}"/>`
        : '';
      const label = (last - i) % labelEvery === 0
        ? `<text class="axis-label" x="${cx}" y="${HEIGHT - 8}" text-anchor="middle">${escapeHtml(dayFormat.format(parseDay(labels[i])))}</text>`
        : '';
      // Zona de hover más grande que la barra: toda la columna.
      const hit = `<rect class="hit" data-index="${i}" x="${PAD.left + step * i}" y="${PAD.top}" width="${step}" height="${plotH}"/>`;
      return label + bar + hit;
    }).join('');

    container.innerHTML = `<svg viewBox="0 0 ${width} ${HEIGHT}" role="img" aria-label="${escapeHtml(title)}">${grid}${bars}</svg>`
      + '<div class="tooltip" hidden></div>'
      + accessibleTable(title, labels, values);

    const tooltip = container.querySelector('.tooltip');
    const svg = container.querySelector('svg');
    const hide = () => {
      tooltip.hidden = true;
      svg.querySelectorAll('.bar.hover').forEach((bar) => bar.classList.remove('hover'));
    };
    svg.addEventListener('mouseleave', hide);
    svg.querySelectorAll('.hit').forEach((hit) => {
      hit.addEventListener('mouseenter', () => {
        const i = Number(hit.dataset.index);
        hide();
        svg.querySelector(`.bar[data-index="${i}"]`)?.classList.add('hover');
        const scale = svg.getBoundingClientRect().width / width;
        tooltip.innerHTML = `<strong>${numberFormat.format(values[i])} ${escapeHtml(unit)}</strong>${escapeHtml(longDayFormat.format(parseDay(labels[i])))}`;
        tooltip.style.left = `${(PAD.left + step * i + step / 2) * scale}px`;
        tooltip.style.top = `${yFor(values[i]) * scale}px`;
        tooltip.hidden = false;
      });
    });
  }

  // Gráfica de barras verticales por día. Se vuelve a dibujar al cambiar el ancho.
  function bars(container, options) {
    const draw = () => renderBars(container, options);
    draw();
    observers.get(container)?.disconnect();
    if (typeof ResizeObserver === 'function') {
      let lastWidth = container.clientWidth;
      const observer = new ResizeObserver(() => {
        if (container.clientWidth === lastWidth) return;
        lastWidth = container.clientWidth;
        draw();
      });
      observer.observe(container);
      observers.set(container, observer);
    }
  }

  // Barras horizontales con etiqueta y valor visibles (sin depender del color).
  function hbars(container, rows, { emptyText = 'Sin datos todavía' } = {}) {
    if (!rows.length || rows.every((row) => !row.value)) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(emptyText)}</div>`;
      return;
    }
    const max = Math.max(...rows.map((row) => row.value), 1);
    container.innerHTML = rows.map((row) => `
      <div class="hbar-row">
        <div class="hbar-label">${row.statusClass ? `<i class="status ${row.statusClass}" style="padding:0;border:0;background:none"></i>` : ''}<span title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span></div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(row.value / max) * 100}%;background:${row.color}"></div></div>
        <div class="hbar-value">${numberFormat.format(row.value)}</div>
      </div>`).join('');
  }

  return { bars, hbars, format: (value) => numberFormat.format(value) };
})();
