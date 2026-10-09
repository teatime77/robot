#include <Arduino.h>
#include <Wire.h>
#include <NimBLEDevice.h>
#include <Adafruit_PWMServoDriver.h>
#include <atomic>
#include "config.h"

enum Op : uint8_t { ARM=1, MOVE=2, STOP=3, STREAM=4, PING=5, INFO=6, DISABLE=7 };
enum Code : uint8_t { CODE_OK=0, CODE_FORMAT=1, CODE_RANGE=2, CODE_NOT_ARMED=3, CODE_HARDWARE=4, CODE_BUSY=5, CODE_IO_ERROR=6 };
struct Command { uint8_t bytes[10]; };
struct Servo {
  bool armed=false, moving=false;
  uint16_t current=9000, start=9000, target=9000, duration=0;
  uint32_t started=0;
};
Servo servos[16];
Adafruit_PWMServoDriver pwm(PCA_ADDRESS);
QueueHandle_t commands;
std::atomic<bool> connected{false}, mustStop{false};
std::atomic<uint16_t> urgentSeq{0};
std::atomic<bool> urgentStop{false};
std::atomic<uint32_t> session{0};
struct Queued { Command command; uint32_t session; };
NimBLECharacteristic *telemetryChar, *statusChar;
bool pcaOK=false, pcaInitialized=false, imuOK=false;
uint8_t imuAddress=0x68;
uint16_t streamHz=0, sampleSeq=0;
uint32_t lastCommand=0, lastSample=0, lastMotion=0;

uint16_t get16(const uint8_t *b) { return uint16_t(b[0]) | uint16_t(b[1])<<8; }
void put16(uint8_t *b,uint16_t v) { b[0]=v; b[1]=v>>8; }
void put32(uint8_t *b,uint32_t v) { for(int i=0;i<4;i++) b[i]=v>>(8*i); }
bool probe(uint8_t address) { Wire.beginTransmission(address); return Wire.endTransmission()==0; }
bool writeRegister(uint8_t reg,uint8_t value) {
  Wire.beginTransmission(imuAddress); Wire.write(reg); Wire.write(value);
  return Wire.endTransmission()==0;
}
bool readRegisters(uint8_t reg,uint8_t *data,uint8_t count) {
  Wire.beginTransmission(imuAddress); Wire.write(reg);
  if(Wire.endTransmission(false)!=0) return false;
  if(Wire.requestFrom(imuAddress,count)!=count) return false;
  for(uint8_t i=0;i<count;i++) data[i]=Wire.read();
  return true;
}
bool setupIMU() {
  if(!probe(0x68)) { if(!probe(0x69)) return false; imuAddress=0x69; }
  uint8_t who=0;
  if(!readRegisters(0x75,&who,1) || who!=0x68) return false;
  // PLL clock, DLPF ~44 Hz, 100 Hz internal sampling, +/-2g, +/-250 deg/s.
  return writeRegister(0x6B,0x01) && writeRegister(0x1A,0x03) &&
    writeRegister(0x19,9) && writeRegister(0x1B,0) && writeRegister(0x1C,0);
}
bool anyArmed() { for(auto &s:servos) if(s.armed) return true; return false; }
void allOff() {
  for(uint8_t ch=0;ch<16;ch++) {
    servos[ch].armed=false; servos[ch].moving=false;
    if(pcaInitialized && pwm.setPWM(ch,0,4096)!=0) pcaOK=false;
  }
}
uint8_t flags() { return (pcaOK?1:0)|(imuOK?2:0)|(anyArmed()?4:0)|(streamHz?8:0); }
void status(uint8_t code,uint16_t seq,uint8_t ch=255) {
  uint8_t b[12]={1,code,0,0,flags(),ch}; put16(b+2,seq);
  if(ch<16) {
    Servo &s=servos[ch]; put16(b+6,s.current); put16(b+8,s.target);
    uint32_t elapsed=millis()-s.started;
    put16(b+10,s.moving && elapsed<s.duration?s.duration-elapsed:0);
  }
  statusChar->setValue(b,sizeof b);
  if(connected) statusChar->notify();
}
bool output(uint8_t ch,uint16_t angle) {
  float us=MIN_PULSE_US+(MAX_PULSE_US-MIN_PULSE_US)*(angle/18000.0f);
  uint16_t ticks=lroundf(us*SERVO_FREQUENCY*4096.0f/1000000.0f);
  if(pwm.setPWM(ch,0,ticks)!=0) { pcaOK=false; allOff(); status(CODE_IO_ERROR,0,ch); return false; }
  return true;
}
class ServerCallbacks: public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*,NimBLEConnInfo&) override {
    ++session; connected=true; mustStop=true;
    Serial.println("BLE connected");
  }
  void onDisconnect(NimBLEServer*,NimBLEConnInfo&,int reason) override {
    connected=false; ++session; mustStop=true;
    Serial.printf("BLE disconnected: reason=%d\n",reason);
    if(NimBLEDevice::startAdvertising()) Serial.println("BLE advertising restarted");
    else Serial.println("BLE advertising restart FAILED");
  }
};
class CommandCallbacks: public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c,NimBLEConnInfo&) override {
    auto value=c->getValue();
    // Keep I2C and notifications in loop(), never in the BLE callback.
    if(value.size()==10 && uint8_t(value[0])==1 && uint8_t(value[1])==STOP) {
      urgentSeq=uint8_t(value[2])|(uint16_t(uint8_t(value[3]))<<8);
      urgentStop=true; return;
    }
    Queued q{}; q.session=session.load();
    if(value.size()==10) memcpy(q.command.bytes,value.data(),10);
    // Wrong-length requests are represented by version 0 and rejected by loop.
    if(xQueueSend(commands,&q,0)!=pdTRUE) mustStop=true;
  }
};
void handle(const Command &command) {
  const uint8_t *b=command.bytes; uint16_t seq=get16(b+2),v=get16(b+6),ms=get16(b+8);
  uint8_t op=b[1],ch=b[4];
  if(b[0]!=1 || b[5]!=0) {status(CODE_FORMAT,seq);return;}
  if(op<ARM || op>DISABLE) {status(CODE_FORMAT,seq);return;}
  lastCommand=millis();
  if(op==PING || op==INFO) {status(CODE_OK,seq,ch);return;}
  if(op==STREAM) {
    if(v!=0 && v!=5 && v!=10 && v!=20) {status(CODE_RANGE,seq);return;}
    if(v && !imuOK) {status(CODE_HARDWARE,seq);return;}
    streamHz=v; lastSample=millis(); status(CODE_OK,seq);return;
  }
  if(op==STOP) {allOff(); status(CODE_OK,seq);return;}
  if(ch>=16) {status(CODE_RANGE,seq);return;}
  if(op==DISABLE) {
    servos[ch].armed=false; servos[ch].moving=false;
    if(pcaOK && pwm.setPWM(ch,0,4096)!=0) {pcaOK=false;allOff();status(CODE_IO_ERROR,seq,ch);return;}
    status(CODE_OK,seq,ch);return;
  }
  if(!pcaOK) {status(CODE_HARDWARE,seq,ch);return;}
  if(v<MIN_ANGLE || v>MAX_ANGLE || ms>10000) {status(CODE_RANGE,seq,ch);return;}
  Servo &s=servos[ch];
  if(op==ARM) {
    s.armed=true; s.moving=false; s.current=s.start=s.target=v;
    if(output(ch,v)) status(CODE_OK,seq,ch); else status(CODE_IO_ERROR,seq,ch);
    return;
  }
  if(!s.armed) {status(CODE_NOT_ARMED,seq,ch);return;}
  s.start=s.current; s.target=v; s.duration=ms; s.started=millis(); s.moving=ms>0;
  if(ms==0) {s.current=v;if(!output(ch,v)) {status(CODE_IO_ERROR,seq,ch);return;}}
  status(CODE_OK,seq,ch);
}
void setup() {
  Serial.begin(115200); delay(200);
  Wire.begin(SDA_PIN,SCL_PIN); Wire.setClock(100000); Wire.setTimeOut(30);
  Serial.println("ESP32 BLE Lab: servo outputs OFF at startup");
  Serial.print("I2C:"); for(uint8_t a=1;a<127;a++) if(probe(a)) Serial.printf(" 0x%02X",a);
  Serial.println();
  pcaOK=probe(PCA_ADDRESS) && pwm.begin();
  pcaInitialized=pcaOK;
  if(pcaOK) {allOff(); pwm.setPWMFreq(SERVO_FREQUENCY); allOff();}
  imuOK=setupIMU();
  Serial.printf("PCA9685=%s MPU6050=%s (0x%02X)\n",pcaOK?"OK":"MISSING",imuOK?"OK":"MISSING",imuAddress);
  commands=xQueueCreate(16,sizeof(Queued));
  if(!commands) {Serial.println("Queue allocation failed");while(true)delay(1000);}
  NimBLEDevice::init(DEVICE_NAME);
  auto server=NimBLEDevice::createServer(); server->setCallbacks(new ServerCallbacks());
  auto service=server->createService(SERVICE_UUID);
  auto cmd=service->createCharacteristic(COMMAND_UUID,NIMBLE_PROPERTY::WRITE,10);
  cmd->setCallbacks(new CommandCallbacks());
  telemetryChar=service->createCharacteristic(TELEMETRY_UUID,NIMBLE_PROPERTY::NOTIFY,20);
  statusChar=service->createCharacteristic(STATUS_UUID,NIMBLE_PROPERTY::READ|NIMBLE_PROPERTY::NOTIFY,12);
  status(CODE_OK,0); service->start();
  auto adv=NimBLEDevice::getAdvertising();
  // Flags + 128-bit UUID + name exceed the 31-byte advertising payload.
  // Enable scan response BEFORE setName so the complete name goes there.
  adv->enableScanResponse(true);
  if(!adv->addServiceUUID(SERVICE_UUID)) {
    Serial.println("BLE service UUID advertising setup FAILED"); return;
  }
  if(!adv->setName(DEVICE_NAME)) {
    Serial.println("BLE device name advertising setup FAILED"); return;
  }
  if(!adv->start()) {
    Serial.println("BLE advertising start FAILED"); return;
  }
  Serial.printf("BLE advertising: %s\n",DEVICE_NAME);
  Serial.printf("BLE address: %s\n",NimBLEDevice::getAddress().toString().c_str());
}
void loop() {
  uint32_t now=millis();
  if(mustStop.exchange(false)) {allOff();streamHz=0;lastCommand=now;xQueueReset(commands);status(CODE_OK,0);}
  if(urgentStop.exchange(false)) {allOff();xQueueReset(commands);lastCommand=now;status(CODE_OK,urgentSeq);}
  Queued q;
  // Bound work per iteration so motion and watchdog are not starved.
  for(int n=0;n<4 && xQueueReceive(commands,&q,0)==pdTRUE;n++)
    if(connected && q.session==session.load()) handle(q.command);
  now=millis();
  if(connected && now-lastCommand>HEARTBEAT_TIMEOUT_MS) {
    bool active=anyArmed() || streamHz;
    if(active) {allOff(); streamHz=0; status(CODE_NOT_ARMED,0);}
  }
  if(now-lastMotion>=20) {
    lastMotion=now;
    for(uint8_t ch=0;ch<16;ch++) {
      Servo &s=servos[ch]; if(!s.armed || !s.moving)continue;
      uint32_t elapsed=now-s.started;
      if(elapsed>=s.duration) {s.current=s.target;s.moving=false;}
      else s.current=int32_t(s.start)+(int32_t(s.target)-s.start)*int32_t(elapsed)/s.duration;
      if(!output(ch,s.current)) break;
    }
  }
  if(connected && imuOK && streamHz && now-lastSample>=1000/streamHz) {
    lastSample=now; uint8_t raw[14];
    if(!readRegisters(0x3B,raw,14)) {imuOK=false;streamHz=0;status(CODE_IO_ERROR,0);}
    else {
      uint8_t b[20]={1,flags()};put16(b+2,++sampleSeq);put32(b+4,now);
      for(int i=0;i<3;i++) {b[8+2*i]=raw[2*i+1];b[9+2*i]=raw[2*i];}
      for(int i=0;i<3;i++) {b[14+2*i]=raw[9+2*i];b[15+2*i]=raw[8+2*i];}
      telemetryChar->setValue(b,sizeof b);telemetryChar->notify();
    }
  }
  delay(2);
}
