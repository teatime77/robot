export const UUID = {
  service: 'f3641400-00b0-4240-ba50-05ca45bf8abc',
  command: 'f3641401-00b0-4240-ba50-05ca45bf8abc',
  telemetry: 'f3641402-00b0-4240-ba50-05ca45bf8abc',
  status: 'f3641403-00b0-4240-ba50-05ca45bf8abc',
};
export const OP = { arm: 1, move: 2, stop: 3, stream: 4, ping: 5, info: 6, disable: 7 } as const;
export type Operation = typeof OP[keyof typeof OP];
export const ERRORS = ['成功', '指令形式が不正', '範囲外の指令', 'サーボが無効／応答タイムアウト', 'デバイスが見つかりません', '指令が混雑しています', 'I²C通信エラー'];
export function command(op: Operation, seq: number, channel = 255, value = 0, duration = 0): Uint8Array {
  if (!Number.isInteger(seq) || seq < 1 || seq > 65535) throw new Error('Invalid sequence');
  if (op === OP.arm || op === OP.move || op === OP.disable) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error('Invalid channel');
  }
  if ((op === OP.arm || op === OP.move) && (!Number.isInteger(value) || value < 6000 || value > 12000)) throw new Error('Invalid angle');
  if (!Number.isInteger(duration) || duration < 0 || duration > 10000) throw new Error('Invalid duration');
  if (op === OP.stream && ![0, 5, 10, 20].includes(value)) throw new Error('Invalid sample rate');
  const bytes = new Uint8Array(10), d = new DataView(bytes.buffer);
  bytes[0] = 1; bytes[1] = op; d.setUint16(2, seq, true); bytes[4] = channel;
  d.setUint16(6, value, true); d.setUint16(8, duration, true); return bytes;
}
export function parseStatus(d: DataView) {
  if (d.byteLength !== 12 || d.getUint8(0) !== 1) throw new Error('Invalid status packet');
  const flags = d.getUint8(4);
  return { code: d.getUint8(1), seq: d.getUint16(2, true), pca: !!(flags & 1), imu: !!(flags & 2),
    armed: !!(flags & 4), streaming: !!(flags & 8), channel: d.getUint8(5),
    angle: d.getUint16(6, true) / 100, target: d.getUint16(8, true) / 100, remaining: d.getUint16(10, true) };
}
export type Status = ReturnType<typeof parseStatus>;
export function parseTelemetry(d: DataView) {
  if (d.byteLength !== 20 || d.getUint8(0) !== 1) throw new Error('Invalid telemetry packet');
  const acceleration = [8, 10, 12].map(o => d.getInt16(o, true) / 16384 * 9.80665);
  const gyro = [14, 16, 18].map(o => d.getInt16(o, true) / 131);
  return { seq: d.getUint16(2, true), uptime: d.getUint32(4, true), acceleration, gyro };
}
export type Sample = ReturnType<typeof parseTelemetry>;
