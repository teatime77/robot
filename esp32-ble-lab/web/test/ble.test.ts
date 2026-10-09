import test from 'node:test';
import assert from 'node:assert/strict';
import { BleTransport } from '../src/ble.ts';
import { OP, UUID } from '../src/protocol.ts';

test('GATT writes are serialized and disconnect rejects pending commands', async () => {
  let active=0, maximum=0, suppressAck=false;
  const writes: number[]=[];
  class Characteristic extends EventTarget {
    value=new DataView(new ArrayBuffer(12));
    constructor(){super();this.value.setUint8(0,1);this.value.setUint8(4,3);}
    async startNotifications(){return this;}
    async readValue(){return this.value;}
    async writeValueWithResponse(bytes: Uint8Array){
      active++;maximum=Math.max(maximum,active);writes.push(bytes[1]);
      await new Promise(resolve=>setTimeout(resolve,3));active--;
      if(!suppressAck){
        state.value=new DataView(new ArrayBuffer(12));state.value.setUint8(0,1);state.value.setUint8(4,3);
        state.value.setUint16(2,new DataView(bytes.buffer).getUint16(2,true),true);
        state.dispatchEvent(new Event('characteristicvaluechanged'));
      }
    }
  }
  const tx=new Characteristic(),state=new Characteristic(),rx=new Characteristic();
  const device=new EventTarget() as EventTarget & {gatt: any};
  device.gatt={connected:false,async connect(){this.connected=true;return this;},
    async getPrimaryService(){return {async getCharacteristic(uuid: string){return uuid===UUID.command?tx:uuid===UUID.status?state:rx;}};},
    disconnect(){this.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{isSecureContext:true}});
  Object.defineProperty(navigator,'bluetooth',{configurable:true,value:{async requestDevice(){return device;}}});
  const ble=new BleTransport();let disconnects=0;ble.onDisconnect=()=>disconnects++;
  try{
    await ble.connect();
    await Promise.all([ble.send(OP.ping),ble.send(OP.info)]);
    assert.equal(maximum,1);assert.deepEqual(writes,[OP.info,OP.ping,OP.info]);
    suppressAck=true;
    const pending=ble.send(OP.ping);const rejected=assert.rejects(pending,/接続が切れ/);
    await new Promise(resolve=>setTimeout(resolve,10));ble.disconnect();await rejected;
    assert.equal(ble.connected,false);assert.equal(disconnects,1);
    suppressAck=false;await ble.connect();assert.equal(ble.connected,true);
  }finally{ble.disconnect();delete (navigator as any).bluetooth;delete (globalThis as any).window;}
});
