import test from 'node:test';
import assert from 'node:assert/strict';
import { command, OP, parseStatus, parseTelemetry } from '../src/protocol.ts';

test('command fits the default BLE payload and uses little endian', () => {
  assert.deepEqual([...command(OP.move, 0x1234, 2, 9000, 1000)], [1,2,0x34,0x12,2,0,0x28,0x23,0xe8,3]);
});
test('reject unsafe angles, channels, duration and unsupported sensor rates', () => {
  assert.throws(() => command(OP.arm, 1, 0, 0));
  assert.throws(() => command(OP.move, 1, 16, 9000));
  assert.throws(() => command(OP.move, 1, 0, 9000, 10001));
  assert.throws(() => command(OP.stream, 1, 255, 200));
});
test('decode negative sensor values and physical units', () => {
  const d = new DataView(new ArrayBuffer(20)); d.setUint8(0,1); d.setUint16(2,65535,true); d.setUint32(4,123456,true);
  d.setInt16(8,-16384,true); d.setInt16(12,16384,true); d.setInt16(14,-131,true);
  const sample=parseTelemetry(d); assert.equal(sample.seq,65535); assert.equal(sample.uptime,123456);
  assert.equal(sample.acceleration[0],-9.80665); assert.equal(sample.acceleration[2],9.80665); assert.equal(sample.gyro[0],-1);
});
test('status flags and malformed packets', () => {
  const d=new DataView(new ArrayBuffer(12)); d.setUint8(0,1);d.setUint8(4,15);d.setUint8(5,3);d.setUint16(6,9000,true);
  const s=parseStatus(d);assert.ok(s.pca&&s.imu&&s.armed&&s.streaming);assert.equal(s.angle,90);assert.equal(s.channel,3);
  assert.throws(()=>parseTelemetry(d));d.setUint8(0,2);assert.throws(()=>parseStatus(d));
});
