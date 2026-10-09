import './style.css';
import { BleTransport } from './ble.ts';
import { OP, ERRORS, type Status, type Sample } from './protocol.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => $<HTMLButtonElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const ble = new BleTransport();
let state: Status | undefined, busy = false, connecting = false;
const armedChannels = new Set<number>();
const samples: (Sample & { received: string })[] = [];
let sessionSamples = 0, dropped = 0, previousSeq: number | undefined;
const logLines: string[] = [];
function log(text: string) {
  logLines.unshift(`${new Date().toLocaleTimeString()}  ${text}`);
  if (logLines.length > 60) logLines.pop(); $('log').textContent = logLines.join('\n');
}
function message(text: string) { $('message').textContent = text; }
function render() {
  const ready = ble.connected && !!state, ch = Number(select('channel').value);
  button('connect').disabled = ready || connecting;
  button('disconnect').disabled = !ready || connecting;
  $('connection-state').textContent = ready ? '接続済み' : connecting ? '接続中' : '未接続';
  $('connection-state').classList.toggle('online', ready);
  $('pca').textContent = state ? state.pca ? '検出OK' : '未検出／エラー' : '—';
  $('imu').textContent = state ? state.imu ? '検出OK' : '未検出／エラー' : '—';
  $('armed').textContent = armedChannels.size ? `CH ${[...armedChannels].join(', ')} 有効` : '停止';
  select('channel').disabled = !ready || busy;
  $<HTMLInputElement>('angle').disabled = !ready || !state?.pca || busy;
  select('duration').disabled = !ready || !state?.pca || busy;
  button('arm').disabled = !ready || !state?.pca || busy || armedChannels.has(ch);
  button('move').disabled = !ready || !state?.pca || busy || !armedChannels.has(ch);
  button('disable').disabled = !ready || busy || !armedChannels.has(ch);
  button('stop').disabled = !ready;
  select('rate').disabled = !ready || !state?.imu || busy || !!state?.streaming;
  button('stream').disabled = !ready || !state?.imu || busy;
  button('stream').textContent = state?.streaming ? '計測停止' : '計測開始';
  button('csv').disabled = samples.length === 0;
}
ble.onStatus = s => {
  state = s;
  if (!s.armed) armedChannels.clear();
  if (s.code && s.seq === 0) { log(ERRORS[s.code] ?? `Error ${s.code}`); message('ESP32で停止または通信エラーが発生しました。'); }
  render();
};
ble.onDisconnect = () => { state = undefined; armedChannels.clear(); connecting = false; busy = false; previousSeq = undefined; render(); message('切断しました。ESP32のPWM出力は停止します。'); log('切断'); };
ble.onError = e => { log(e.message); message(e.message); };
const canvas = $<HTMLCanvasElement>('chart'), ctx = canvas.getContext('2d')!;
function chart() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#d9e4e9'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * h / 4); ctx.lineTo(w, i * h / 4); ctx.stroke(); }
  const recent = samples.slice(-100);
  ['#237cb8', '#ce663c', '#399a79'].forEach((color, axis) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    recent.forEach((s, i) => { const x = i * w / 99, y = h / 2 - Math.max(-20, Math.min(20, s.acceleration[axis])) * h / 40; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
  });
}
ble.onSample = sample => {
  if (previousSeq !== undefined) { const delta = (sample.seq - previousSeq + 65536) % 65536; if (delta > 0 && delta < 32768) dropped += delta - 1; }
  previousSeq = sample.seq; sessionSamples++;
  samples.push({ ...sample, received: new Date().toISOString() }); if (samples.length > 6000) samples.shift();
  ['ax', 'ay', 'az'].forEach((id, i) => $(id).textContent = sample.acceleration[i].toFixed(3));
  ['gx', 'gy', 'gz'].forEach((id, i) => $(id).textContent = sample.gyro[i].toFixed(2));
  $('samples').textContent = `受信 ${sessionSamples}件 / 欠番 ${dropped}件 / 起動から ${(sample.uptime / 1000).toFixed(1)}秒`;
  button('csv').disabled = false; chart();
};
async function run(action: () => Promise<unknown>, success: string) {
  if (busy) return; busy = true; render();
  try { await action(); message(success); log(success); }
  catch (e) { const text = (e as Error).message; message(text); log(text); }
  finally { busy = false; render(); }
}
for (let ch = 0; ch < 16; ch++) select('channel').add(new Option(`CH ${ch}`, String(ch)));
select('channel').onchange = render;
$<HTMLInputElement>('angle').oninput = () => $('angle-label').textContent = `${$<HTMLInputElement>('angle').value}°`;
button('connect').onclick = async () => {
  connecting = true; render();
  try { await ble.connect(); sessionSamples = 0; dropped = 0; previousSeq = undefined; message('接続しました。サーボを有効化するか、IMU計測を開始してください。'); log('接続完了'); }
  catch (e) { message((e as Error).message); log((e as Error).message); }
  finally { connecting = false; render(); }
};
button('disconnect').onclick = () => ble.disconnect();
button('arm').onclick = () => { const ch = Number(select('channel').value); void run(async () => { await ble.send(OP.arm, ch, 9000); armedChannels.add(ch); }, `CH ${ch}: 90°で有効化しました。`); };
button('move').onclick = () => { const ch = Number(select('channel').value), angle = Number($<HTMLInputElement>('angle').value), duration = Number(select('duration').value); void run(() => ble.send(OP.move, ch, angle * 100, duration), `CH ${ch}: ${angle}°への指令を受け付けました。`); };
button('disable').onclick = () => { const ch = Number(select('channel').value); void run(async () => { await ble.send(OP.disable, ch); armedChannels.delete(ch); }, `CH ${ch}: PWMを停止しました。`); };
button('stop').onclick = async () => {
  try { await ble.send(OP.stop); armedChannels.clear(); render(); message('全チャンネルのPWMを停止しました。'); log('全PWM停止'); }
  catch (e) { message((e as Error).message); ble.disconnect(); }
};
button('stream').onclick = () => { const starting = !state?.streaming; void run(async () => { await ble.send(OP.stream, 255, starting ? Number(select('rate').value) : 0); previousSeq = undefined; }, starting ? 'IMU計測を開始しました。' : 'IMU計測を停止しました。'); };
button('csv').onclick = () => {
  const text = ['received_iso,esp_uptime_ms,sequence,ax_m_s2,ay_m_s2,az_m_s2,gx_deg_s,gy_deg_s,gz_deg_s', ...samples.map(s => [s.received, s.uptime, s.seq, ...s.acceleration, ...s.gyro].join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `imu-${Date.now()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// Background tabs cannot maintain reliable timing. Disable outputs while still foregrounded.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ble.connected) { void ble.send(OP.stop).catch(() => {}).finally(() => ble.disconnect()); }
});
window.addEventListener('pagehide', () => ble.disconnect());
if (!window.isSecureContext || !navigator.bluetooth) {
  $('support').hidden = false;
  $('support').textContent = !window.isSecureContext ? 'Web BluetoothにはHTTPSが必要です。Windowsでの開発は http://localhost:5173/ で開いてください。AndroidでPCのLAN IPをHTTPで開く方法は使えません。' : 'Web Bluetoothがありません。WindowsまたはAndroidのChromeで開いてください。';
  button('connect').hidden = true;
}
chart(); render();
