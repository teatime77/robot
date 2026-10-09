import { command, ERRORS, OP, parseStatus, parseTelemetry, UUID, type Operation, type Status, type Sample } from './protocol.ts';
export class BleTransport {
  device?: BluetoothDevice;
  private tx?: BluetoothRemoteGATTCharacteristic;
  private rx?: BluetoothRemoteGATTCharacteristic;
  private state?: BluetoothRemoteGATTCharacteristic;
  private seq = 0;
  private generation = 0;
  private heartbeat?: ReturnType<typeof setInterval>;
  private pending = new Map<number, { resolve: (s: Status) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private tail: Promise<unknown> = Promise.resolve();
  onStatus: (s: Status) => void = () => {};
  onSample: (s: Sample) => void = () => {};
  onDisconnect: () => void = () => {};
  onError: (e: Error) => void = () => {};
  get connected() { return !!this.tx && !!this.device?.gatt?.connected; }
  private statusChanged = (event: Event) => {
    try { this.receive((event.target as BluetoothRemoteGATTCharacteristic).value!); }
    catch (e) { this.onError(e as Error); }
  };
  private sampleChanged = (event: Event) => {
    try { this.onSample(parseTelemetry((event.target as BluetoothRemoteGATTCharacteristic).value!)); }
    catch (e) { this.onError(e as Error); }
  };
  private lost = () => {
    this.generation++;
    clearInterval(this.heartbeat); this.heartbeat = undefined;
    this.rx?.removeEventListener('characteristicvaluechanged', this.sampleChanged);
    this.state?.removeEventListener('characteristicvaluechanged', this.statusChanged);
    this.device?.removeEventListener('gattserverdisconnected', this.lost);
    this.tx = this.rx = this.state = undefined;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('BLE接続が切れました')); }
    this.pending.clear(); this.onDisconnect();
  };
  private receive(d: DataView) {
    const s = parseStatus(d); this.onStatus(s);
    const p = this.pending.get(s.seq);
    if (p) {
      clearTimeout(p.timer); this.pending.delete(s.seq);
      if (s.code) p.reject(new Error(ERRORS[s.code] ?? `Error ${s.code}`)); else p.resolve(s);
    }
  }
  async connect() {
    if (!window.isSecureContext) throw new Error('HTTPS、またはこのPCのlocalhostで開いてください。');
    if (!navigator.bluetooth) throw new Error('このChromeではWeb Bluetoothを利用できません。');
    // requestDevice must run directly in the button's user gesture.
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.service] }] });
    this.device = device; device.addEventListener('gattserverdisconnected', this.lost);
    try {
      const server = await device.gatt!.connect(); const service = await server.getPrimaryService(UUID.service);
      this.tx = await service.getCharacteristic(UUID.command);
      this.rx = await service.getCharacteristic(UUID.telemetry);
      this.state = await service.getCharacteristic(UUID.status);
      this.state.addEventListener('characteristicvaluechanged', this.statusChanged);
      this.rx.addEventListener('characteristicvaluechanged', this.sampleChanged);
      await this.state.startNotifications(); await this.rx.startNotifications();
      this.receive(await this.state.readValue());
      await this.send(OP.info);
      this.heartbeat = setInterval(() => { void this.send(OP.ping).catch(e => this.onError(e)); }, 1500);
    } catch (e) { this.disconnect(); throw e; }
  }
  send(op: Operation, channel = 255, value = 0, duration = 0): Promise<Status> {
    // Serialize writes and acknowledgement waits: Chrome rejects parallel GATT operations.
    const device = this.device;
    const generation = this.generation;
    const task = this.tail.catch(() => {}).then(async () => {
      if (!this.connected || this.device !== device || this.generation !== generation) throw new Error('ESP32へ接続してください。');
      const seq = this.seq = this.seq % 65535 + 1;
      const bytes = command(op, seq, channel, value, duration);
      let resolveAck!: (s: Status) => void, rejectAck!: (e: Error) => void;
      const ack = new Promise<Status>((resolve, reject) => { resolveAck = resolve; rejectAck = reject; });
      // Attach immediately so a disconnection during the write never creates an unhandled rejection.
      void ack.catch(() => {});
      const timer = setTimeout(() => {
        this.pending.delete(seq); rejectAck(new Error('ESP32の応答がありません。再接続してください。'));
        this.disconnect();
      }, 2500);
      this.pending.set(seq, { resolve: resolveAck, reject: rejectAck, timer });
      try { await this.tx!.writeValueWithResponse(bytes); }
      catch (e) { clearTimeout(timer); this.pending.delete(seq); rejectAck(e as Error); }
      return ack;
    });
    this.tail = task; return task;
  }
  disconnect() {
    this.device?.removeEventListener('gattserverdisconnected', this.lost);
    this.device?.gatt?.disconnect();
    this.lost();
  }
}
