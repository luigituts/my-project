# Coospo H9Z Heart Rate PWA

A simple, static Progressive Web App that connects to a Coospo H9Z chest heart rate monitor through Web Bluetooth and displays:

- Current heart rate
- Current heart rate zone
- Heart rate range for each zone
- Rolling heart rate chart for the past 15 minutes
- Demo mode for UI testing without a device

## Heart rate zones

The app uses these zones by default:

| Zone | Range |
| --- | --- |
| Zone 1 | 96 - 115 BPM |
| Zone 2 | 115 - 134 BPM |
| Zone 3 | 134 - 153 BPM |
| Zone 4 | 153 - 172 BPM |
| Zone 5 | 172 - 191 BPM |

The zone calculation uses the lower bound as inclusive. For overlapping edges, the higher zone starts at the shared number. Example: 115 BPM is Zone 2.

## Browser requirements

Use a browser that supports Web Bluetooth. Chrome or Edge on desktop and Android are the best options. iPhone and iPad Safari do not currently support this workflow reliably.

Web Bluetooth requires a secure context. GitHub Pages works because it serves the site over HTTPS. Local testing also works on localhost.

## Local testing

```bash
cd coospo-heart-rate-pwa
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## How to connect the Coospo H9Z

1. Wear the H9Z strap so the sensor wakes up.
2. Keep the strap close to your phone or computer.
3. Open the app in Chrome or Edge.
4. Click **Connect H9Z**.
5. Choose the H9Z or COOSPO device from the browser Bluetooth picker.
6. Wait for the first live heart rate notification.

You do not need to pair the device in your operating system first. Use the browser picker.

## Deploy to GitHub Pages

### Option A, upload through the GitHub UI

1. Create a new GitHub repository, for example `coospo-heart-rate-pwa`.
2. Upload all files from this folder to the repository root.
3. Go to **Settings** > **Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main` and folder `/root`.
6. Save.
7. Open the Pages URL once deployment finishes.

Your URL will usually look like:

```text
https://YOUR_USERNAME.github.io/coospo-heart-rate-pwa/
```

### Option B, deploy with Git

```bash
git init
git add .
git commit -m "Initial heart rate PWA"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/coospo-heart-rate-pwa.git
git push -u origin main
```

Then enable GitHub Pages from **Settings** > **Pages**.

## Troubleshooting

### The device does not appear

- Wear the strap first.
- Moisten the strap electrodes.
- Turn Bluetooth on.
- Keep the H9Z close to the device.
- Close other apps that may already be connected to the H9Z.
- Try the browser picker again.

### It connects, then no data appears

- Wait a few seconds for the first notification.
- Make sure the strap is making good skin contact.
- Disconnect and reconnect from the app.

### It works locally but not after deployment

- Confirm the deployed URL starts with `https://`.
- Clear the browser cache after updating the app.
- Make sure all files are in the repository root if using `/root` Pages deployment.
