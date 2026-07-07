const HEART_RATE_SERVICE = 'heart_rate';
const HEART_RATE_MEASUREMENT = 'heart_rate_measurement';
const STORAGE_KEY = 'coospo-h9z-heart-rate-samples-v2';
const SAMPLE_WINDOW_MS = 15 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

const ZONES = [
  { id: 1, name: 'Zone 1', min: 96, max: 115, color: '#9ca3af', fill: 'rgba(156, 163, 175, 0.16)' },
  { id: 2, name: 'Zone 2', min: 115, max: 134, color: '#2f80ed', fill: 'rgba(47, 128, 237, 0.14)' },
  { id: 3, name: 'Zone 3', min: 134, max: 153, color: '#10a34a', fill: 'rgba(16, 163, 74, 0.16)' },
  { id: 4, name: 'Zone 4', min: 153, max: 172, color: '#f97316', fill: 'rgba(249, 115, 22, 0.15)' },
  { id: 5, name: 'Zone 5', min: 172, max: 191, color: '#ff1744', fill: 'rgba(255, 23, 68, 0.14)' }
];

const elements = {
  bpmValue: document.querySelector('#bpmValue'),
  updatedText: document.querySelector('#updatedText'),
  zoneName: document.querySelector('#zoneName'),
  zoneHelper: document.querySelector('#zoneHelper'),
  rangePill: document.querySelector('#rangePill'),
  zoneSegments: document.querySelector('#zoneSegments'),
  zoneKnob: document.querySelector('#zoneKnob'),
  zoneLegend: document.querySelector('#zoneLegend'),
  chart: document.querySelector('#hrChart'),
  chartTitle: document.querySelector('#chartTitle'),
  connectButton: document.querySelector('#connectButton'),
  controlsCard: document.querySelector('#controlsCard'),
  connectionStatus: document.querySelector('#connectionStatus'),
  connectionText: document.querySelector('#connectionText')
};

const state = {
  device: null,
  characteristic: null,
  samples: loadStoredSamples(),
  mode: 'idle'
};

function supportsWebBluetooth() {
  return Boolean(navigator.bluetooth && navigator.bluetooth.requestDevice);
}

function loadStoredSamples() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => Number.isFinite(item.t) && Number.isFinite(item.bpm))
      .filter((item) => Date.now() - item.t <= SAMPLE_WINDOW_MS)
      .sort((a, b) => a.t - b.t)
      .slice(-1200);
  } catch {
    return [];
  }
}

function saveStoredSamples() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.samples.slice(-1200)));
  } catch {
    // Storage can fail in private browsing. The app still works during the session.
  }
}

function cleanOldSamples(now = Date.now()) {
  const cutoff = now - SAMPLE_WINDOW_MS;
  const previousLength = state.samples.length;
  state.samples = state.samples.filter((item) => item.t >= cutoff && item.t <= now + 5000);
  if (state.samples.length !== previousLength) saveStoredSamples();
}

function getLatestSample() {
  return state.samples[state.samples.length - 1] || null;
}

function getZoneForBpm(bpm) {
  if (!Number.isFinite(bpm)) return null;
  const zone = ZONES.find((item, index) => {
    const upperMatch = index === ZONES.length - 1 ? bpm <= item.max : bpm < item.max;
    return bpm >= item.min && upperMatch;
  });
  if (zone) return zone;
  if (bpm < ZONES[0].min) return { id: 0, name: 'Below Zone 1', min: 0, max: ZONES[0].min, color: '#9ca3af', fill: 'rgba(156, 163, 175, 0.16)' };
  return { id: 6, name: 'Above Zone 5', min: ZONES[4].max, max: 240, color: '#ff1744', fill: 'rgba(255, 23, 68, 0.14)' };
}

function getZoneDisplayRange(zone) {
  if (!zone) return '96 - 191 BPM';
  if (zone.id === 0) return `< ${ZONES[0].min} BPM`;
  if (zone.id === 6) return `> ${ZONES[4].max} BPM`;
  return `${zone.min} - ${zone.max} BPM`;
}

function addHeartRateSample(bpm, readingTime = Date.now()) {
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 240) return;
  state.samples.push({ t: readingTime, bpm: Math.round(bpm) });
  state.samples.sort((a, b) => a.t - b.t);
  cleanOldSamples(readingTime);
  saveStoredSamples();
  renderAll();
}

function parseHeartRateMeasurement(value) {
  const flags = value.getUint8(0);
  const isUint16 = Boolean(flags & 0x01);
  const sensorContactBits = flags & 0x06;
  const contactSupported = sensorContactBits === 0x04 || sensorContactBits === 0x06;
  const contactDetected = sensorContactBits === 0x06;
  const energyPresent = Boolean(flags & 0x08);
  const rrPresent = Boolean(flags & 0x10);

  let offset = 1;
  const bpm = isUint16 ? value.getUint16(offset, true) : value.getUint8(offset);
  offset += isUint16 ? 2 : 1;

  if (energyPresent) offset += 2;

  const rrIntervals = [];
  if (rrPresent) {
    while (offset + 1 < value.byteLength) {
      rrIntervals.push(value.getUint16(offset, true) / 1024);
      offset += 2;
    }
  }

  return { bpm, contactSupported, contactDetected, rrIntervals };
}

function handleHeartRateNotification(event) {
  const reading = parseHeartRateMeasurement(event.target.value);
  addHeartRateSample(reading.bpm);

  if (reading.contactSupported && !reading.contactDetected) {
    elements.updatedText.textContent = 'Reading received, sensor contact may be weak.';
  }
}

async function connectHeartRateMonitor() {
  if (!supportsWebBluetooth()) {
    setStatus('idle', 'Bluetooth unsupported');
    elements.updatedText.textContent = 'Use Chrome or Edge on Android, Windows, or macOS.';
    return;
  }

  elements.connectButton.disabled = true;
  elements.connectButton.textContent = 'Connecting...';
  setStatus('idle', 'Choose your H9Z');

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [HEART_RATE_SERVICE] },
        { namePrefix: 'H9Z' },
        { namePrefix: 'COOSPO' },
        { namePrefix: 'Coospo' }
      ],
      optionalServices: [HEART_RATE_SERVICE, 'battery_service', 'device_information']
    });

    state.device = device;
    state.device.addEventListener('gattserverdisconnected', handleDisconnected);

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    const characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    state.characteristic = characteristic;

    characteristic.addEventListener('characteristicvaluechanged', handleHeartRateNotification);
    await characteristic.startNotifications();

    setStatus('connected', device.name || 'H9Z connected');
    elements.updatedText.textContent = 'Waiting for the first live reading...';
  } catch (error) {
    console.error(error);
    setStatus('idle', 'Not connected');
    elements.updatedText.textContent = friendlyBluetoothError(error);
  } finally {
    elements.connectButton.disabled = false;
    elements.connectButton.textContent = 'Connect H9Z';
  }
}

function friendlyBluetoothError(error) {
  const message = String(error && error.message ? error.message : error);
  if (/User cancelled|cancelled|canceled/i.test(message)) return 'Connection cancelled. Tap Connect H9Z to try again.';
  if (/No Services matching|not found|NotFoundError/i.test(message)) return 'No H9Z found. Wear the strap, keep it nearby, then try again.';
  if (/NetworkError|GATT/i.test(message)) return 'Could not open the Bluetooth session. Turn Bluetooth off and on, then try again.';
  return 'Could not connect. Make sure the strap is awake and not connected to another app.';
}

function handleDisconnected() {
  if (state.characteristic) {
    state.characteristic.removeEventListener('characteristicvaluechanged', handleHeartRateNotification);
  }
  state.characteristic = null;
  state.device = null;
  setStatus('idle', 'Disconnected');
  if (!getLatestSample()) elements.updatedText.textContent = 'Connect your H9Z to begin.';
}

function setStatus(mode, text) {
  state.mode = mode;
  elements.connectionStatus.classList.toggle('connected', mode === 'connected');
  elements.connectionText.textContent = text;
  elements.controlsCard.hidden = mode === 'connected';
}

function renderZoneStaticParts(activeZone) {
  elements.zoneSegments.innerHTML = '';
  elements.zoneLegend.innerHTML = '';

  ZONES.forEach((zone) => {
    const segment = document.createElement('div');
    segment.className = `zone-segment ${activeZone?.id === zone.id ? '' : 'inactive'}`;
    segment.style.background = zone.color;
    elements.zoneSegments.appendChild(segment);

    const label = document.createElement('div');
    label.className = `zone-label ${activeZone?.id === zone.id ? 'active' : ''}`;
    label.style.setProperty('--zone-color', zone.color);
    label.innerHTML = `<strong>${zone.name}</strong><span class="zone-range-number">${zone.min}-${zone.max}</span><span class="zone-range-unit">BPM</span>`;
    elements.zoneLegend.appendChild(label);
  });
}

function renderCurrentStats() {
  const latest = getLatestSample();
  const bpm = latest?.bpm;
  const zone = getZoneForBpm(bpm);

  elements.bpmValue.textContent = Number.isFinite(bpm) ? String(bpm) : '--';
  elements.zoneName.textContent = zone ? zone.name : 'Waiting';
  elements.zoneName.style.color = zone?.color || '#10a34a';
  elements.zoneHelper.textContent = zone ? zoneDescription(zone) : 'The app uses your configured heart rate zones.';
  elements.rangePill.textContent = getZoneDisplayRange(zone);
  elements.rangePill.style.color = zone?.color || '#10a34a';
  elements.rangePill.style.background = zone ? hexToSoftBackground(zone.color) : 'rgba(16, 163, 74, 0.18)';

  if (latest) elements.updatedText.textContent = formatUpdatedText(latest.t);

  const meterMin = ZONES[0].min;
  const meterMax = ZONES[ZONES.length - 1].max;
  const pct = Number.isFinite(bpm) ? clamp((bpm - meterMin) / (meterMax - meterMin), 0, 1) : 0.5;
  elements.zoneKnob.style.setProperty('--knob-left', `${pct * 100}%`);
  elements.zoneKnob.style.borderColor = zone?.color || '#10a34a';

  renderZoneStaticParts(zone);
}

function zoneDescription(zone) {
  if (zone.id === 0) return 'Below your configured training zones.';
  if (zone.id === 6) return 'Above your configured Zone 5 range.';
  if (zone.id === 1) return 'Light effort or recovery range.';
  if (zone.id === 2) return 'Easy aerobic effort range.';
  if (zone.id === 3) return 'Moderate aerobic effort range.';
  if (zone.id === 4) return 'Hard effort range.';
  return 'Very hard effort range.';
}

function hexToSoftBackground(hex) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.16)`;
}

function formatUpdatedText(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Updated ${minutes}m ago`;
}

function getChartSamples(now) {
  cleanOldSamples(now);
  return state.samples
    .filter((sample) => sample.t >= now - SAMPLE_WINDOW_MS && sample.t <= now)
    .sort((a, b) => a.t - b.t);
}

function getVisibleXWindow(samples, now) {
  if (!samples.length) return ONE_MINUTE_MS;
  const oldestTime = samples[0].t;
  const elapsedMs = Math.max(0, now - oldestTime);
  return clamp(elapsedMs || ONE_MINUTE_MS, ONE_MINUTE_MS, SAMPLE_WINDOW_MS);
}

function getYBounds(samples) {
  if (!samples.length) return { yMin: 60, yMax: 200 };

  const values = samples.map((sample) => sample.bpm);
  const minBpm = Math.min(...values);
  const maxBpm = Math.max(...values);
  const yMax = Math.ceil(maxBpm);
  let yMin = Math.floor((minBpm - 8) / 5) * 5;

  if (yMax - yMin < 20) yMin = yMax - 20;
  if (yMin < 0) yMin = 0;
  if (yMin >= yMax) yMin = Math.max(0, yMax - 20);

  return { yMin, yMax };
}

function buildYTicks(yMin, yMax) {
  const ticks = [];
  const count = 5;
  for (let i = 0; i < count; i += 1) {
    ticks.push(Math.round(yMin + ((yMax - yMin) * i) / (count - 1)));
  }
  ticks[0] = Math.round(yMin);
  ticks[ticks.length - 1] = Math.round(yMax);
  return [...new Set(ticks)].sort((a, b) => a - b);
}

function buildXTicks(windowMs) {
  const totalSeconds = Math.round(windowMs / 1000);
  if (totalSeconds <= 60) {
    return [60, 45, 30, 15, 0].map((seconds) => ({
      offsetMs: seconds * 1000,
      line1: seconds === 0 ? 'Now' : seconds === 60 ? '1 min' : `${seconds}s`,
      line2: seconds === 0 ? '' : 'ago'
    }));
  }

  const tickCount = 6;
  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = (tickCount - 1 - index) / (tickCount - 1);
    const offsetMs = windowMs * ratio;
    return {
      offsetMs,
      line1: formatTickDuration(offsetMs),
      line2: offsetMs === 0 ? '' : 'ago'
    };
  });
}

function formatTickDuration(offsetMs) {
  const seconds = Math.round(offsetMs / 1000);
  if (seconds <= 0) return 'Now';
  if (seconds < 60) return `${seconds}s`;

  const minutes = seconds / 60;
  if (Math.abs(minutes - Math.round(minutes)) < 0.05) return `${Math.round(minutes)} min`;
  if (minutes < 10) return `${minutes.toFixed(1)} min`;
  return `${Math.floor(minutes)} min`;
}

function formatChartTitle(windowMs, hasSamples) {
  if (!hasSamples) return 'Heart Rate';
  const minutes = windowMs / ONE_MINUTE_MS;
  if (minutes <= 1.05) return 'Heart Rate, Past 1 Minute';
  if (minutes < 10) return `Heart Rate, Past ${minutes.toFixed(1)} Minutes`;
  return `Heart Rate, Past ${Math.floor(minutes)} Minutes`;
}

function renderChart() {
  const svg = elements.chart;
  const width = 680;
  const height = 470;
  const padding = { top: 22, right: 96, bottom: 66, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const now = Date.now();
  const hardWindowSamples = getChartSamples(now);
  const xWindowMs = getVisibleXWindow(hardWindowSamples, now);
  const start = now - xWindowMs;
  const chartSamples = hardWindowSamples.filter((sample) => sample.t >= start && sample.t <= now);
  const { yMin, yMax } = getYBounds(chartSamples);

  elements.chartTitle.textContent = formatChartTitle(xWindowMs, chartSamples.length > 0);
  svg.setAttribute('aria-label', `${elements.chartTitle.textContent} heart rate line chart`);

  const xScale = (time) => padding.left + ((time - start) / xWindowMs) * plotWidth;
  const yScale = (bpm) => padding.top + (1 - (bpm - yMin) / (yMax - yMin)) * plotHeight;

  svg.innerHTML = '';

  const defs = createSvgElement('defs');
  const lineGradient = createSvgElement('linearGradient', { id: 'lineGradient', x1: '0%', x2: '100%', y1: '0%', y2: '0%' });
  lineGradient.append(
    createSvgElement('stop', { offset: '0%', 'stop-color': '#ff1744' }),
    createSvgElement('stop', { offset: '100%', 'stop-color': '#ff5d7d' })
  );
  defs.appendChild(lineGradient);
  svg.appendChild(defs);

  drawBand(svg, yScale, yMin, yMax, padding.left, plotWidth, yMin, Math.min(ZONES[0].min, yMax), 'rgba(156, 163, 175, 0.09)');
  ZONES.forEach((zone) => {
    drawBand(svg, yScale, yMin, yMax, padding.left, plotWidth, zone.min, zone.max, zone.fill);
  });
  drawBand(svg, yScale, yMin, yMax, padding.left, plotWidth, Math.max(ZONES[ZONES.length - 1].max, yMin), yMax, 'rgba(255, 23, 68, 0.09)');

  buildYTicks(yMin, yMax).forEach((tick) => {
    const y = yScale(tick);
    svg.appendChild(createSvgElement('line', {
      x1: padding.left,
      x2: padding.left + plotWidth,
      y1: y,
      y2: y,
      class: tick === Math.round(yMin) ? 'axis-line' : 'grid-line'
    }));
    const text = createSvgElement('text', {
      x: padding.left - 18,
      y: y + 6,
      'text-anchor': 'end',
      class: 'axis-label'
    });
    text.textContent = String(tick);
    svg.appendChild(text);
  });

  buildXTicks(xWindowMs).forEach((tick) => {
    const x = xScale(now - tick.offsetMs);
    const text = createSvgElement('text', {
      x,
      y: padding.top + plotHeight + 34,
      'text-anchor': 'middle',
      class: 'axis-label'
    });
    text.textContent = tick.line1;
    svg.appendChild(text);

    if (tick.line2) {
      const text2 = createSvgElement('text', {
        x,
        y: padding.top + plotHeight + 56,
        'text-anchor': 'middle',
        class: 'axis-label'
      });
      text2.textContent = tick.line2;
      svg.appendChild(text2);
    }
  });

  renderVisibleZoneLabels(svg, yScale, yMin, yMax, padding.left + plotWidth + 22);

  if (chartSamples.length >= 2) {
    const d = chartSamples
      .map((sample, index) => `${index === 0 ? 'M' : 'L'} ${xScale(sample.t).toFixed(1)} ${yScale(sample.bpm).toFixed(1)}`)
      .join(' ');
    const areaD = `${d} L ${xScale(chartSamples[chartSamples.length - 1].t).toFixed(1)} ${yScale(yMin).toFixed(1)} L ${xScale(chartSamples[0].t).toFixed(1)} ${yScale(yMin).toFixed(1)} Z`;
    svg.appendChild(createSvgElement('path', {
      d: areaD,
      fill: 'rgba(255, 23, 68, 0.13)'
    }));
    svg.appendChild(createSvgElement('path', {
      d,
      fill: 'none',
      stroke: 'url(#lineGradient)',
      'stroke-width': 4,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }));
  }

  if (chartSamples.length >= 1) {
    const last = chartSamples[chartSamples.length - 1];
    svg.appendChild(createSvgElement('circle', {
      cx: xScale(last.t),
      cy: yScale(last.bpm),
      r: 8,
      fill: '#fff',
      stroke: '#ff1744',
      'stroke-width': 5
    }));
  } else {
    const emptyText = createSvgElement('text', {
      x: padding.left + plotWidth / 2,
      y: padding.top + plotHeight / 2,
      'text-anchor': 'middle',
      class: 'axis-label'
    });
    emptyText.textContent = 'Waiting for heart rate data';
    svg.appendChild(emptyText);
  }

  svg.appendChild(createSvgElement('line', {
    x1: padding.left,
    x2: padding.left + plotWidth,
    y1: padding.top + plotHeight,
    y2: padding.top + plotHeight,
    class: 'axis-line'
  }));
}

function drawBand(svg, yScale, yMin, yMax, x, width, bandMin, bandMax, fill) {
  const lower = clamp(bandMin, yMin, yMax);
  const upper = clamp(bandMax, yMin, yMax);
  if (upper <= lower) return;

  const yTop = yScale(upper);
  const yBottom = yScale(lower);
  svg.appendChild(createSvgElement('rect', {
    x,
    y: Math.min(yTop, yBottom),
    width,
    height: Math.max(1, Math.abs(yBottom - yTop)),
    fill
  }));
}

function renderVisibleZoneLabels(svg, yScale, yMin, yMax, x) {
  if (yMin < ZONES[0].min) {
    const lower = yMin;
    const upper = Math.min(ZONES[0].min, yMax);
    if (upper > lower) {
      appendZoneText(svg, x, yScale((lower + upper) / 2), 'Below Z1', '#9ca3af');
    }
  }

  ZONES.forEach((zone) => {
    const lower = Math.max(zone.min, yMin);
    const upper = Math.min(zone.max, yMax);
    if (upper <= lower) return;
    appendZoneText(svg, x, yScale((lower + upper) / 2), zone.name, zone.color);
  });

  if (yMax > ZONES[ZONES.length - 1].max) {
    const lower = Math.max(ZONES[ZONES.length - 1].max, yMin);
    const upper = yMax;
    if (upper > lower) {
      appendZoneText(svg, x, yScale((lower + upper) / 2), 'Above Z5', '#ff1744');
    }
  }
}

function appendZoneText(svg, x, y, label, color) {
  const text = createSvgElement('text', {
    x,
    y: y + 6,
    class: 'zone-text',
    fill: color
  });
  text.textContent = label;
  text.setAttribute('style', `fill:${color}`);
  svg.appendChild(text);
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function renderAll() {
  renderCurrentStats();
  renderChart();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker registration failed', error));
  });
}

function bindEvents() {
  elements.connectButton.addEventListener('click', connectHeartRateMonitor);
}

function bootstrap() {
  registerServiceWorker();
  bindEvents();
  renderAll();

  if (!supportsWebBluetooth()) {
    elements.connectButton.disabled = true;
    elements.connectButton.textContent = 'Bluetooth unavailable';
    elements.updatedText.textContent = 'Web Bluetooth is unavailable in this browser.';
  }

  window.setInterval(() => {
    const latest = getLatestSample();
    if (latest) elements.updatedText.textContent = formatUpdatedText(latest.t);
    renderChart();
  }, 5000);
}

bootstrap();
