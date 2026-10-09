# BLE protocol v1

GATT service: `f3641400-00b0-4240-ba50-05ca45bf8abc`

| Characteristic | UUID末尾前の識別子 | Properties | サイズ |
|---|---|---|---|
| Command | f3641401 | Write with response | 10 bytes |
| Telemetry | f3641402 | Notify | 20 bytes |
| Status | f3641403 | Read / Notify | 12 bytes |

UUIDの残り部分はサービスと同じです。全てlittle endian。BLEの既定ATT MTU 23（データ20byte）に収まります。
BLEのWrite responseはGATTの受付を示し、Status通知がアプリ側の受付結果を示します。
MOVEの受付成功は動作完了を意味しません。INFOにチャンネルを指定すると現在の内部指令値・目標値・残り時間を取得できます。

## Command

| Offset | 型 | 内容 |
|---|---|---|
| 0 | u8 | version=1 |
| 1 | u8 | opcode |
| 2 | u16 | sequence 1..65535。0はサーバー自発通知用 |
| 4 | u8 | channel 0..15、全体の操作は255 |
| 5 | u8 | reserved=0 |
| 6 | u16 | value |
| 8 | u16 | duration_ms 0..10000 |

| Opcode | 名前 | value | 動作 |
|---|---|---|---|
| 1 | ARM | 角度×100 | PWM開始、即時指令 |
| 2 | MOVE | 角度×100 | durationで補間、0なら即時 |
| 3 | STOP | 0 | 全出力無効・待機指令破棄。IMU通知は継続 |
| 4 | STREAM | 0/5/10/20 | IMU通知Hz、0は停止 |
| 5 | PING | 0 | ハートビート |
| 6 | INFO | 0 | 状態取得 |
| 7 | DISABLE | 0 | 指定CHのみ無効 |

ARM/MOVEは初期設定で6000..12000のみ受け付けます。
接続時・切断時は全出力とストリームを停止。5秒間有効形式の指令がなければ全出力とストリームを停止します。
Web側PINGは1.5秒周期。停止後にPINGが再開しても出力は再有効化されません。
BLEコールバックでは指令をキューへ入れ、loopでI²C処理を実行します。STOPは優先フラグを使用します。

## Status

| Offset | 型 | 内容 |
|---|---|---|
| 0 | u8 | version=1 |
| 1 | u8 | code |
| 2 | u16 | ack sequence、0は自発通知 |
| 4 | u8 | flags |
| 5 | u8 | channel、全体255 |
| 6 | u16 | 内部指令角度×100（チャンネル指定時） |
| 8 | u16 | 目標角度×100 |
| 10 | u16 | 残り時間ms |

flags: bit0 PCA正常、bit1 IMU正常、bit2いずれかのCH有効、bit3 IMU通知有効。
code: 0 OK、1形式エラー、2範囲エラー、3未有効/タイムアウト停止、4ハードウェア未検出、5混雑（予約）、6 I²Cエラー。
キュー飽和時は全PWM停止・キュー破棄となり、未処理の指令にはACKが返りません。Web側のACKタイムアウトで切断します。
不正な長さのパケットはFORMAT seq=0で通知します。

## Telemetry

| Offset | 型 | 内容 |
|---|---|---|
| 0 | u8 | version=1 |
| 1 | u8 | flags（Statusと同じ） |
| 2 | u16 | サンプルsequence（wrapあり） |
| 4 | u32 | ESP32 millis（wrapあり） |
| 8,10,12 | i16 | ax,ay,az raw |
| 14,16,18 | i16 | gx,gy,gz raw |

加速度±2g: raw / 16384 × 9.80665 m/s²。
角速度±250°/s: raw / 131 °/s。
温度・姿勢角はこの版に含めません。100Hzの内部センサ設定を最大20Hzで読み出すため、高周波の動きの解析用ではありません。

Web transportはGATT操作を直列化し、ACKを待ってから次の操作を行います。ACK待ち上限2.5秒。
