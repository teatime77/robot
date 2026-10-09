# ESP32 BLE Lab

ESP32 DevKit V1 + PCA9685 + GY-521/MPU-6050を、Windows / AndroidのChromeから操作する教材用プロジェクトです。
ファームウェアはArduinoフレームワークのPlatformIO、画面はTypeScript + Viteです。Wi-Fiは使用しません。

## できること

- BLEからPCA9685のCH0〜15を個別に操作。起動・再接続時は全チャンネルのPWMを停止。
- 選択チャンネルを90°で有効化し、60〜120°の範囲で目標角度と移動時間を指定。
- ESP32内で20msごとに指令角度を補間。Chromeは細かいPWMタイミングを担当しません。
- 選択チャンネル／全チャンネルのPWM停止。
- MPU-6050の加速度・角速度を5/10/20Hzで通知、グラフ表示、CSV保存。
- 切断時または指令・ハートビートが5秒途切れたらPWMとIMU通知を停止。
- Chromeをバックグラウンドへ移したときは停止指令を送り切断。再接続後に手動で再有効化。

サーボの実角度フィードバック、姿勢推定、カメラ、AI、ビジュアルプログラミング、Wi-Fiは含みません。

## ファイル構成

```
firmware/
  platformio.ini       PlatformIOの設定
  include/config.h    ピン・角度範囲・パルス幅・BLE UUID
  src/main.cpp        BLE、サーボ、IMU
web/
  src/                TypeScript / CSS
  dist/               ビルド済みウェブアプリ（そのままHTTPS公開可能）
  test/               通信プロトコルのテスト
docs/
  wiring.md           配線と電源
  protocol.md         BLEデータ仕様
  validation.md       検証結果と実機確認項目
```

## 1. 配線

[docs/wiring.md](docs/wiring.md)を参照してください。ESP32はUSB給電、PCA9685のVCCとGY-521のVCCは3.3V、サーボ用V+は外部5Vです。
最初はサーボを外してI²CとBLEだけ確認します。

## 2. ESP32に書き込む（Windows / VS Code）

1. VS CodeにPlatformIO IDE拡張をインストール。
2. このZIPを展開し、**`firmware`フォルダー**をVS Codeで開く。
3. ESP32をUSB接続。必要ならCP2102のドライバーを導入。
4. PlatformIOの「Build」、続けて「Upload」を実行。環境は`esp32dev`。
5. Serial Monitorを115200bpsで開く。

期待される表示：

```
ESP32 BLE Lab: servo outputs OFF at startup
I2C: 0x40 0x68
PCA9685=OK MPU6050=OK (0x68)
BLE advertising: ESP32-BLE-Lab
```

PCA9685のAll Callアドレス`0x70`も検出されることがあります。MPU-6050はAD0の設定によって`0x69`になります。
`MISSING`の場合は電源・GND・SDA/SCLを確認してください。画面の接続自体はできますが、該当機能は無効になります。
I²Cエラー発生後は配線を直してESP32をリセットしてください。

PlatformIOのターミナルで行う場合：

```powershell
pio run
pio run -t upload
pio device monitor -b 115200
```

ポート選択が必要な場合は`platformio.ini`に実際のポートを指定します。例：

```ini
upload_port = COM3
monitor_port = COM3
```

## 3. Windowsでウェブアプリを開く

Bluetooth対応PCが必要です。非対応PCはUSB Bluetoothアダプターを追加してください。

### ソースから起動

Node.js 22 LTS以降を用意し、`web`フォルダーで実行します。

```powershell
npm ci
npm run dev
```

同じPCのChromeで `http://localhost:5173/` を開きます。localhostは開発用の安全なコンテキストとして扱われます。
WindowsのBluetoothをONにし、画面の「ESP32に接続」から機器を選択します。OS設定で事前にペアリングする必要はありません。

### ビルド済み画面だけ使う

Pythonがある場合は`web/dist`をカレントフォルダーにして：

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Chromeで `http://localhost:8000/` を開きます。HTMLをダブルクリックして`file://`で開く方法は使いません。

## 4. Android携帯・タブレットで開く

Androidからは**HTTPSで公開されたページ**を使用してください。
PCの `http://192.168.x.x:5173/` をAndroidから開いてもWeb Bluetoothは使えません。

手軽な公開方法はGitHub Pagesです（公開操作はこのプロジェクトには行っていません）。

1. 自分のGitHubに公開用リポジトリを作成。
2. **`web/dist`の中身**（`index.html`と`assets`フォルダー）を、そのリポジトリのルートに配置してcommit。
3. Settings → Pages → Deploy from a branch → `main` / `(root)` → Save。
4. 表示されたHTTPS URLをAndroidのChromeで開く。
5. BluetoothをONにして「ESP32に接続」をタップ。
6. 古いAndroidでは、BLE機器の検出に位置情報をONにする必要がある場合があります。

`vite.config.ts`に`base: './'`を設定しているので、GitHub Pagesのリポジトリ名付きURLでも動きます。
画面変更後は`npm run build`で`dist`を再生成し、公開ファイルを更新してください。
公開ページにAPIキーや秘密情報は含みません。接続したロボットは各端末のBLE経由で操作されます。

## 5. 最初の動作確認

1. サーボを接続せず、両デバイスが「検出OK」になることを確認。
2. 「計測開始」を押して、GY-521を傾ける。静止時は重力方向の加速度が約9.8m/s²。
3. 電源を切り、機構・サーボホーンを外したSG90をCH0に1個だけ接続。
4. 外部5V電源を接続し、ESP32を起動してChromeから再接続。
5. 「90°で有効化」を押す。ここでサーボは動く可能性があります。
6. 目標を75°または105°、移動時間を1秒にして「目標角度へ移動」。
7. 「全チャンネルのPWM停止」、切断、画面のバックグラウンド化をそれぞれ確認。

角度は指令値です。SG90の個体差・バックラッシュ・負荷で実角度はずれます。
パルス幅1000〜2000µsを公称0〜180°として換算していますが、サーボの実際の対応は校正が必要です。
可動範囲やパルス幅は`firmware/include/config.h`で変更できます。角度範囲変更時は`web/index.html`と`web/src/protocol.ts`も同じ範囲にしてください。

## 注意と接続の方針

- この試作は1台の操作端末を前提とした、近距離の教材用です。複数端末から同時に操作しないでください。
- BLE暗号化・所有者認証は未実装です。公開場所で利用する次段階では、物理的な接続受付ボタン・認証を追加してください。
- PWM停止は電源遮断ではなく、故障時まで停止を保証する機能でもありません。即時に止める必要がある機構にはサーボ電源のスイッチを設けてください。
- タブが隠れたときの停止指令が届かなくても、ESP32の5秒タイムアウトが働きます。再開時は再接続が必要です。
- Bluetoothが利用できない場合、Chromeの対応、PCのアダプター、WindowsのBluetooth設定を確認してください。
- Wi-Fiを追加する際は、画面と`protocol.ts`を再利用し、`ble.ts`に相当する通信部分を追加する構成にできます。

## 開発と検証

```powershell
cd web
npm ci
npm run build
npm test
```

テストにはNode.js 22.6以降が必要です。[検証結果](docs/validation.md)で実機確認との区別を示しています。

## 参考資料

- [Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)
- [Adafruit PCA9685 pinouts](https://learn.adafruit.com/16-channel-pwm-servo-driver/pinouts)
- [NimBLE-Arduino](https://github.com/h2zero/NimBLE-Arduino)
- [MPU-6050製品資料](https://invensense.tdk.com/products/motion-tracking/6-axis/mpu-6050/)

コードは[MIT License](LICENSE)で利用できます。利用するライブラリーには各ライブラリーのライセンスが適用されます。
