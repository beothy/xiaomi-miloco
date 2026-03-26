# PTZ Reverse Engineering Plan — Xiaomi C301 Camera

## Goal

Capture the raw PTZ directional command bytes sent by the official Xiaomi Home Android app when the user presses Up/Down/Left/Right, then replay those commands from the POC backend.

---

## Why This Is Necessary

The Xiaomi MIoT cloud spec for the C301 (`mxiang.camera.c301`) only exposes:
- `ptz-calibrate` (home/reset, no inputs) — **already implemented**
- `restart-device`

There are no published directional PTZ actions. The commands exist (the camera has a PTZ motor) but travel as **encrypted proprietary payloads** inside Xiaomi's P2P tunnel — invisible to Wireshark. Frida lets us hook the native library _before_ encryption happens to read the plaintext.

---

## Approach: Frida Dynamic Instrumentation

**Frida** is a dynamic instrumentation toolkit. It injects a JavaScript runtime into a running process, lets you hook any native function, and read/modify its arguments before the original code runs. On Android it works by attaching to the app process via `ptrace`.

---

## Prerequisites

| Item | Notes |
|------|-------|
| Rooted Android device or emulator | Physical device: Magisk root. Emulator: Genymotion (ARM) or Android Studio AVD with `su`. |
| Xiaomi Home APK | Install from Play Store or sideload. Version matters — newer builds may have more obfuscation. |
| `frida-server` binary on device | Must match Frida version on PC exactly. |
| `frida-tools` on PC | `pip install frida-tools` |
| ADB | Android Debug Bridge — standard Android SDK tool. |
| `jadx` (optional) | Decompile the APK to find method/symbol names if the so is obfuscated. |

---

## Step 1 — Set Up the Device

### Option A: Physical Android Phone (Recommended)

1. Unlock bootloader (device-specific, voids warranty).
2. Flash Magisk to gain root.
3. Enable Developer Options → **USB Debugging**.
4. Connect to PC via USB, confirm with `adb devices`.

### Option B: Android Emulator

```bash
# Create an x86_64 AVD in Android Studio with API level 28-30
# Start with writable system partition
emulator -avd <name> -writable-system
adb root
adb remount
```

> Note: Xiaomi Home may crash on an emulator without proper camera hardware. A physical device is more reliable.

---

## Step 2 — Install Frida Server on Device

```bash
# 1. Find CPU architecture
adb shell getprop ro.product.cpu.abi
# Common values: arm64-v8a, armeabi-v7a, x86_64

# 2. Download matching frida-server from:
# https://github.com/frida/frida/releases
# e.g. frida-server-16.x.x-android-arm64.xz

# 3. Push and run
adb push frida-server /data/local/tmp/
adb shell chmod +x /data/local/tmp/frida-server
adb shell su -c "/data/local/tmp/frida-server &"

# 4. Forward port
adb forward tcp:27042 tcp:27042

# 5. Verify
frida-ps -U   # should list running processes
```

---

## Step 3 — Identify the Target Library

The P2P camera control code lives in a native `.so` loaded by Xiaomi Home. Candidate names:

- `libmiot_camera.so` (full SDK — vs the `_lite` build in our repo)
- `libp2p.so`
- `libmicamera.so`
- `libmiot_p2p.so`

### Find it at runtime:

```bash
# Get Xiaomi Home PID
frida-ps -U | grep -i xiaomi

# List loaded .so files (replace PID)
adb shell cat /proc/<PID>/maps | grep "\.so" | grep -i "camera\|p2p\|miot"
```

### List exported functions in the target library:

```bash
# Pull the .so off the device
adb shell su -c "cp /data/app/com.xiaomi.smarthome*/lib/arm64/*.so /sdcard/"
adb pull /sdcard/libmiot_camera.so .

# Inspect exports
nm -D libmiot_camera.so | grep -i "ptz\|send\|command\|action"
# or with readelf
readelf -W --syms libmiot_camera.so | grep -i "ptz\|send"
```

Likely candidates:
- `miot_camera_ptz_*`
- `miot_p2p_send`
- `miot_camera_send_command`
- `miot_camera_action`

---

## Step 4 — Write the Frida Hook Script

Once you know the target function name, intercept it:

```javascript
// hook_ptz.js
// Replace 'libmiot_camera.so' and 'miot_camera_send_command' with actual names

Java.perform(function () {
    var libName = "libmiot_camera.so";
    var funcName = "miot_camera_send_command";  // update after Step 3

    var funcAddr = Module.findExportByName(libName, funcName);

    if (funcAddr === null) {
        console.log("[!] Function not found. Try scanning all exports:");
        Process.enumerateModules().forEach(function (m) {
            if (m.name.toLowerCase().includes("camera") || m.name.toLowerCase().includes("p2p")) {
                console.log("[*] Module: " + m.name + " @ " + m.base);
                m.enumerateExports().forEach(function (e) {
                    if (e.name.toLowerCase().includes("send") || e.name.toLowerCase().includes("ptz")) {
                        console.log("    Export: " + e.name + " @ " + e.address);
                    }
                });
            }
        });
        return;
    }

    console.log("[+] Hooking " + funcName + " @ " + funcAddr);

    Interceptor.attach(funcAddr, {
        onEnter: function (args) {
            console.log("\n[PTZ CALL] " + funcName);
            // Dump first 4 args as hex (adjust based on actual signature)
            for (var i = 0; i < 4; i++) {
                try {
                    console.log("  arg[" + i + "] = " + args[i] + " / hex: " + args[i].toString(16));
                    // If arg looks like a buffer pointer, dump 64 bytes
                    if (!args[i].isNull()) {
                        console.log("  buf[" + i + "]: " + hexdump(args[i], { length: 64, ansi: false }));
                    }
                } catch (e) {}
            }
        },
        onLeave: function (retval) {
            console.log("  return: " + retval);
        }
    });
});
```

### Run it:

```bash
# Attach to running Xiaomi Home process
frida -U -n com.xiaomi.smarthome -l hook_ptz.js

# Or spawn a fresh process (avoids missing early init)
frida -U -f com.xiaomi.smarthome -l hook_ptz.js --no-pause
```

---

## Step 5 — Capture PTZ Commands

With the hook running:

1. Open Xiaomi Home → navigate to the C301 camera live view.
2. Press **Up** arrow → observe Frida console output.
3. Press **Down**, **Left**, **Right** in sequence.
4. Note the **exact bytes** that differ between each direction.
5. Press any **stop** button if one exists (important for continuous-movement cameras).

Expected output pattern:
```
[PTZ CALL] miot_camera_send_command
  arg[0] = 0x7abc1234   (camera handle)
  arg[1] = 0x7abc5678   (command buffer)
  buf[1]:
  0000  01 00 00 06 70 74 7a 5f  6d 6f 76 65 00 01 00 00  ....ptz_move....
  0010  ...
```

### Log to file:

```bash
frida -U -n com.xiaomi.smarthome -l hook_ptz.js 2>&1 | tee ptz_capture.log
```

---

## Step 6 — Decode the Command Format

Compare captures for each direction. Common patterns in Xiaomi P2P protocols:

```
[header][command_id][payload_length][payload]
```

Look for:
- A byte or short that changes between Up/Down/Left/Right (direction enum)
- A speed/duration value
- A "stop" command variant

If the data is structured (JSON, protobuf, MIIO), it will be visible as readable text or a recognizable binary format in the hexdump.

---

## Step 7 — Implement in the POC Backend

Once you have the command format, add a new endpoint to the backend:

### `poc-xiaomi-camera-integration/backend/main.py`

```python
class PTZRequest(BaseModel):
    direction: str  # "up" | "down" | "left" | "right" | "stop"
    speed: int = 5  # 1-10

@app.post("/api/devices/{did}/ptz")
async def ptz_move(did: str, req: PTZRequest):
    """Send PTZ directional command via raw P2P channel."""
    device = await get_device(did)
    # Build command bytes from captured format
    cmd = build_ptz_command(req.direction, req.speed)
    result = await send_raw_camera_command(device, cmd)
    return {"status": "ok", "result": result}
```

### Corresponding frontend update in `CameraList.jsx`:

Enable the directional arrow buttons and call the new endpoint instead of the cloud action API.

---

## Step 8 — Re-enable Arrows in the Frontend

In [poc-xiaomi-camera-integration/frontend/src/components/CameraList.jsx](../poc-xiaomi-camera-integration/frontend/src/components/CameraList.jsx):

1. Replace `handlePTZHome()` stub with real `handlePTZMove(direction)`.
2. Remove `opacity: 0.35` / `cursor: not-allowed` from arrow buttons.
3. Add stop-on-mouseup for smooth control.

---

## Risk & Mitigations

| Risk | Mitigation |
|------|-----------|
| Xiaomi Home uses SSL pinning / anti-tamper | Use `objection` patcher or Magisk TrustMeAlready module to bypass cert pinning before attaching Frida |
| APK is packed/obfuscated | Use `jadx` + `apktool` to identify native call sites; may need pattern scanning instead of export-name lookup |
| Command format changes with app update | Pin the APK version once working; document the version tested |
| Camera firmware varies | Test on C301 firmware version — may differ from other C3xx models |
| Root requirement | Not needed if using an emulator — but camera P2P init may fail without real hardware |

---

## Tools Summary

| Tool | Install | Purpose |
|------|---------|---------|
| `frida` | `pip install frida-tools` | Core instrumentation |
| `frida-server` | GitHub releases | Runs on Android device |
| `adb` | Android SDK platform-tools | Device management |
| `jadx` | https://github.com/skylot/jadx | APK decompilation |
| `objection` | `pip install objection` | SSL pinning bypass, easier Frida shell |
| `readelf` / `nm` | Linux binutils | Inspect `.so` exports |

---

## Quick Start Checklist

- [ ] Rooted Android device ready, ADB connected
- [ ] `frida-server` version matches `frida-tools` version on PC
- [ ] `adb forward tcp:27042 tcp:27042` active
- [ ] Xiaomi Home installed and signed in on device
- [ ] Camera C301 visible in Xiaomi Home app
- [ ] `frida-ps -U` lists `com.xiaomi.smarthome`
- [ ] `libmiot_camera.so` (or equivalent) found in process maps
- [ ] Hook script attached without crash
- [ ] PTZ Up captured → bytes logged
- [ ] All 4 directions + stop captured
- [ ] Command format decoded
- [ ] Backend `/api/devices/{did}/ptz` endpoint implemented
- [ ] Frontend arrows re-enabled and tested
