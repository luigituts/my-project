const HEART_RATE_SERVICE = 'heart_rate';
const HEART_RATE_MEASUREMENT = 'heart_rate_measurement';
const STORAGE_KEY = 'coospo-h9z-heart-rate-samples-v1';
const SAMPLE_WINDOW_MS = 15 * 60 * 1000;

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
  connectButton: document.querySelector('#connectButton'),
  disconnectButton: document.querySelector('#disconnectButton'),
  demoButton: document.querySelector('#demoButton'),
  clearButton: document.querySelector('#clearButton'),
  connectionStatus: document.querySelector('#connectionStatus'),
  connectionText: document.querySelector('#connectionText')
};

const state = {
  device: null,
  characteristic: null,
  samples: loadStoredSamples(),
  lastReadingAt: null,
  demoTimer: null,
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

function seedDemoSamples() {
  const now = Date.now();
  const points = [];
  for (let i = 90; i >= 0; i -= 1) {
    const t = now - (i * SAMPLE_WINDOW_MS) / 90;
    const climb = 94 + (42 * (90 - i)) / 90;
    const wave = Math.sin(i / 4.2) * 4 + Math.cos(i / 8) * 3;
    const coolDown = i < 30 ? (30 - i) * 0.65 : 0;
    points.push({ t, bpm: Math.round(climb + wave - coolDown) });
  }
  state.samples = points;
  state.lastReadingAt = now;
  saveStoredSamples();
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
  return { id: 6, name: 'Above Zone 5', min: ZONES[4].max, max: 230, color: '#ff1744', fill: 'rgba(255, 23, 68, 0.14)' };
}

function getZoneDisplayRange(zone) {
  if (!zone) return '96 - 191 BPM';
  if (zone.id === 0) return `< ${ZONES[0].min} BPM`;
  if (zone.id === 6) return `> ${ZONES[4].max} BPM`;
  return `${zone.min} - ${zone.max} BPM`;
}

function cleanOldSamples() {
  const cutoff = Date.now() - SAMPLE_WINDOW_MS;
  state.samples = state.samples.filter((item) => item.t >= cutoff);
}

function addHeartRateSample(bpm, readingTime = Date.now()) {
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 240) return;
  state.samples.push({ t: readingTime, bpm: Math.round(bpm) });
  state.lastReadingAt = readingTime;
  cleanOldSamples();
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

  stopDemoMode();
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
    elements.disconnectButton.hidden = false;
    elements.connectButton.textContent = 'Connected';
  } catch (error) {
    console.error(error);
    setStatus('idle', 'Not connected');
    elements.updatedText.textContent = friendlyBluetoothError(error);
    elements.connectButton.textContent = 'Connect H9Z';
  } finally {
    elements.connectButton.disabled = false;
  }
}

function friendlyBluetoothError(error) {
  const message = String(error && error.message ? error.message : error);
  if (/User cancelled|cancelled|canceled/i.test(message)) return 'Connection cancelled. Tap Connect H9Z to try again.';
  if (/No Services matching|not found|NotFoundError/i.test(message)) return 'No H9Z found. Wear the strap, keep it nearby, then try again.';
  if (/NetworkError|GATT/i.test(message)) return 'Could not open the Bluetooth session. Turn Bluetooth off and on, then try again.';
  return 'Could not connect. Make sure the strap is awake and not connected to another app.';
}

async function disconnectHeartRateMonitor() {
  stopDemoMode();
  if (state.characteristic) {
    try {
      state.characteristic.removeEventListener('characteristicvaluechanged', handleHeartRateNotification);
      await state.characteristic.stopNotifications();
    } catch {
      // Notifications may already be stopped.
    }
  }

  if (state.device?.gatt?.connected) {
    state.device.gatt.disconnect();
  } else {
    handleDisconnected();
  }
}

function handleDisconnected() {
  state.characteristic = null;
  state.device = null;
  elements.connectButton.textContent = 'Connect H9Z';
  elements.disconnectButton.hidden = true;

  if (state.mode === 'demo') return;

  setStatus('idle', 'Disconnected');
  if (!getLatestSample()) elements.updatedText.textContent = 'Connect your H9Z to begin.';
}

function startDemoMode() {
  disconnectIfConnectedOnly();
  if (!state.samples.length) seedDemoSamples();
  state.mode = 'demo';
  setStatus('demo', 'Demo mode');
  elements.demoButton.textContent = 'Stop demo';
  elements.updatedText.textContent = 'Demo reading, not from your device.';

  let tick = 0;
  state.demoTimer = window.setInterval(() => {
    tick += 1;
    const latest = getLatestSample()?.bpm || 128;
    const target = 132 + Math.sin(tick / 12) * 12 + Math.cos(tick / 19) * 5;
    const next = latest + (target - latest) * 0.18 + (Math.random() - 0.5) * 4;
    addHeartRateSample(Math.max(86, Math.min(175, next)));
  }, 1000);
  renderAll();
}

function stopDemoMode() {
  if (state.demoTimer) window.clearInterval(state.demoTimer);
  state.demoTimer = null;
  if (state.mode === 'demo') {
    state.mode = 'idle';
    setStatus('idle', state.device ? 'Connected' : 'Not connected');
    elements.demoButton.textContent = 'Demo mode';
  }
}

function disconnectIfConnectedOnly() {
  if (state.device?.gatt?.connected) {
    state.device.gatt.disconnect();
  }
  state.characteristic = null;
  state.device = null;
  elements.disconnectButton.hidden = true;
  elements.connectButton.textContent = 'Connect H9Z';
}

function clearGraph() {
  state.samples = [];
  state.lastReadingAt = null;
  saveStoredSamples();
  localStorage.removeItem(STORAGE_KEY);
  renderAll();
  elements.updatedText.textContent = state.mode === 'demo' ? 'Demo graph cleared. New samples will appear.' : 'Graph cleared.';
}

function setStatus(mode, text) {
  state.mode = mode;
  elements.connectionStatus.classList.toggle('connected', mode === 'connected');
  elements.connectionStatus.classList.toggle('demo', mode === 'demo');
  elements.connectionText.textContent = text;
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
    label.innerHTML = `<strong>${zone.name}</strong><span>${zone.min} - ${zone.max} BPM</span>`;
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

  if (latest) {
    elements.updatedText.textContent = state.mode === 'demo' ? 'Demo reading, not from your device.' : formatUpdatedText(latest.t);
  }

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

function renderChart() {
  cleanOldSamples();

  const svg = elements.chart;
  const width = 680;
  const height = 470;
  const padding = { top: 22, right: 96, bottom: 66, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const yMin = 60;
  const yMax = 200;
  const now = Date.now();
  const start = now - SAMPLE_WINDOW_MS;

  const xScale = (time) => padding.left + ((time - start) / SAMPLE_WINDOW_MS) * plotWidth;
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

  ZONES.forEach((zone) => {
    const yTop = yScale(Math.min(zone.max, yMax));
    const yBottom = yScale(Math.max(zone.min, yMin));
    const rect = createSvgElement('rect', {
      x: padding.left,
      y: Math.min(yTop, yBottom),
      width: plotWidth,
      height: Math.max(1, Math.abs(yBottom - yTop)),
      fill: zone.fill
    });
    svg.appendChild(rect);
  });

  const yTicks = [60, 80, 100, 120, 140, 160, 180, 200];
  yTicks.forEach((tick) => {
    const y = yScale(tick);
    svg.appendChild(createSvgElement('line', {
      x1: padding.left,
      x2: padding.left + plotWidth,
      y1: y,
      y2: y,
      class: tick === yMin ? 'axis-line' : 'grid-line'
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

  const xTicks = [15, 12, 9, 6, 3, 0];
  xTicks.forEach((minutesAgo) => {
    const x = xScale(now - minutesAgo * 60 * 1000);
    const label = minutesAgo === 0 ? 'Now' : `${minutesAgo} min`;
    const text = createSvgElement('text', {
      x,
      y: padding.top + plotHeight + 34,
      'text-anchor': 'middle',
      class: 'axis-label'
    });
    text.textContent = label;
    svg.appendChild(text);
    if (minutesAgo !== 0) {
      const text2 = createSvgElement('text', {
        x,
        y: padding.top + plotHeight + 56,
        'text-anchor': 'middle',
        class: 'axis-label'
      });
      text2.textContent = 'ago';
      svg.appendChild(text2);
    }
  });

  ZONES.forEach((zone) => {
    const midpoint = clamp((zone.min + zone.max) / 2, yMin, yMax);
    const text = createSvgElement('text', {
      x: padding.left + plotWidth + 22,
      y: yScale(midpoint) + 6,
      class: 'zone-text',
      fill: zone.color
    });
    text.textContent = zone.name;
    text.setAttribute('style', `fill:${zone.color}`);
    svg.appendChild(text);
  });

  const chartSamples = state.samples.filter((sample) => sample.t >= start && sample.t <= now);
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
  elements.disconnectButton.addEventListener('click', disconnectHeartRateMonitor);
  elements.clearButton.addEventListener('click', clearGraph);
  elements.demoButton.addEventListener('click', () => {
    if (state.demoTimer) stopDemoMode();
    else startDemoMode();
  });
}

function bootstrap() {
  registerServiceWorker();
  bindEvents();

  renderAll();

  if (!supportsWebBluetooth()) {
    elements.updatedText.textContent = 'Web Bluetooth is unavailable in this browser. Demo mode still works.';
  }

  window.setInterval(() => {
    const latest = getLatestSample();
    if (latest && state.mode !== 'demo') elements.updatedText.textContent = formatUpdatedText(latest.t);
  }, 5000);
}

bootstrap();
