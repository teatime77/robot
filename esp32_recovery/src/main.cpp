#include <Arduino.h>
#include <Wire.h>

// ESP32-motor-IMU(3).fzz: GPIO numbers, not header positions.
constexpr int motor1_enable = 26;
constexpr int motor1_in1 = 27;
constexpr int motor1_in2 = 14;
constexpr int motor2_enable = 19;
constexpr int motor2_in1 = 18;
constexpr int motor2_in2 = 4;
constexpr int motor1_encoder_a = 33;
constexpr int motor1_encoder_b = 25;
constexpr int motor2_encoder_a = 32;
constexpr int motor2_encoder_b = 23;
constexpr int imu_sda = 21;
constexpr int imu_scl = 22;
uint8_t imu_address = 0x68;
bool imu_found = false;

volatile int32_t motor1_count = 0;
volatile int32_t motor2_count = 0;
int active_motor = 0;
uint32_t motor_started_at = 0;
constexpr uint32_t motor_test_duration_ms = 2000;

void IRAM_ATTR countMotor1() {
  motor1_count += digitalRead(motor1_encoder_b) ? 1 : -1;
}

void IRAM_ATTR countMotor2() {
  motor2_count += digitalRead(motor2_encoder_b) ? 1 : -1;
}

void stopMotors() {
  digitalWrite(motor1_enable, LOW);
  digitalWrite(motor2_enable, LOW);
  digitalWrite(motor1_in1, LOW);
  digitalWrite(motor1_in2, LOW);
  digitalWrite(motor2_in1, LOW);
  digitalWrite(motor2_in2, LOW);
}

bool writeImu(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(imu_address);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

int readImuRegister(uint8_t reg) {
  Wire.beginTransmission(imu_address);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom(imu_address, static_cast<uint8_t>(1)) != 1) return -1;
  return Wire.read();
}

void printStatus() {
  int32_t a, b;
  noInterrupts();
  a = motor1_count;
  b = motor2_count;
  interrupts();
  Serial.printf("encoder1=%ld encoder2=%ld", static_cast<long>(a), static_cast<long>(b));

  if (!imu_found) {
    Serial.println(" IMU absent (check GY-521 power/SDA/SCL)");
    return;
  }

  // MPU-6050: accelerometer X/Y/Z, temperature, gyro X/Y/Z (raw values).
  Wire.beginTransmission(imu_address);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0 ||
      Wire.requestFrom(imu_address, static_cast<uint8_t>(14)) != 14) {
    Serial.println(" IMU read failed");
    return;
  }
  int16_t v[7];
  for (int i = 0; i < 7; ++i) {
    v[i] = static_cast<int16_t>((Wire.read() << 8) | Wire.read());
  }
  Serial.printf(" accel=(%d,%d,%d) gyro=(%d,%d,%d)\n",
                v[0], v[1], v[2], v[4], v[5], v[6]);
}

void startMotorTest(int motor) {
  stopMotors();
  active_motor = motor;
  motor_started_at = millis();
  if (motor == 1) {
    digitalWrite(motor1_in1, HIGH);
    digitalWrite(motor1_enable, HIGH);
  } else {
    digitalWrite(motor2_in1, HIGH);
    digitalWrite(motor2_enable, HIGH);
  }
  Serial.printf("motor %d: running for up to %lu ms (s stops now)\n",
                motor, static_cast<unsigned long>(motor_test_duration_ms));
}

void setup() {
  // Set enable outputs LOW before changing direction pins.
  pinMode(motor1_enable, OUTPUT);
  pinMode(motor2_enable, OUTPUT);
  digitalWrite(motor1_enable, LOW);
  digitalWrite(motor2_enable, LOW);
  pinMode(motor1_in1, OUTPUT);
  pinMode(motor1_in2, OUTPUT);
  pinMode(motor2_in1, OUTPUT);
  pinMode(motor2_in2, OUTPUT);
  stopMotors();

  pinMode(motor1_encoder_a, INPUT_PULLUP);
  pinMode(motor1_encoder_b, INPUT_PULLUP);
  pinMode(motor2_encoder_a, INPUT_PULLUP);
  pinMode(motor2_encoder_b, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(motor1_encoder_a), countMotor1, RISING);
  attachInterrupt(digitalPinToInterrupt(motor2_encoder_a), countMotor2, RISING);

  Serial.begin(115200);
  Wire.begin(imu_sda, imu_scl);
  Wire.setClock(100000);
  delay(300);
  Serial.println("ESP32 recovery: motors OFF at startup");
  Serial.print("I2C scan:");
  for (uint8_t address = 0x08; address <= 0x77; ++address) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf(" 0x%02X", address);
      if (address == 0x68 || address == 0x69) {
        imu_address = address;
        imu_found = true;
      }
    }
  }
  Serial.println(imu_found ? " (GY-521 found)" : " (no GY-521 at 0x68/0x69)");
  if (imu_found) {
    int who = readImuRegister(0x75);
    if (who < 0) {
      Serial.println("MPU-6050 register read failed");
      imu_found = false;
    } else {
      Serial.printf("MPU-6050 WHO_AM_I: 0x%02X (expected 0x68)\n", who);
      Serial.printf("MPU wake: %s\n", writeImu(0x6B, 0) ? "OK" : "FAILED");
    }
  }
  Serial.println("Turn wheels by hand; counts print every second.");
  Serial.println("With wheels raised, send 1 or 2 for one 2-second motor run; s stops immediately.");
}

void loop() {
  while (Serial.available()) {
    char command = static_cast<char>(Serial.read());
    if (command == 's' || command == 'S') {
      stopMotors();
      active_motor = 0;
      Serial.println("motors stopped by command");
    }
    if (command == '1' || command == '2') startMotorTest(command - '0');
  }
  if (active_motor != 0 && millis() - motor_started_at >= motor_test_duration_ms) {
    int completed_motor = active_motor;
    stopMotors();
    active_motor = 0;
    Serial.printf("motor %d: 2-second run finished\n", completed_motor);
    printStatus();
  }
  static uint32_t last_report = 0;
  if (millis() - last_report >= 1000) {
    last_report = millis();
    printStatus();
  }
}
