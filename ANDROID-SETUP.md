# BobLost Chatbot — Android build

The Android package wraps the existing admin dashboard with Capacitor. It does not run the WhatsApp bot inside the phone.

## Build

GitHub Actions workflow: `.github/workflows/android-apk.yml`.

Run it from the repository's **Actions** tab using **Build Android APK** → **Run workflow**. The generated debug APK is attached to the successful run as the artifact `BobLost-Chatbot-Android`.

A push to `main` or `fix/android-apk-setup` that changes the dashboard, shared libraries, mobile wrapper, or workflow also triggers a build.

## Required API configuration

The dashboard needs the separately hosted BobLost API. Set the repository Actions variable `VITE_API_BASE_URL` to its HTTPS base URL (without a trailing slash) before building. Do not put `ADMIN_TOKEN`, database credentials, or other secrets in this variable or in the Android app.

The API deployment must allow the Android WebView origin in `ADMIN_CORS_ORIGINS` (normally `https://localhost` for this Capacitor configuration). Confirm the admin session cookie's cross-origin/SameSite behavior on Android before relying on the app for administration.

The API server must remain hosted and running independently; installing the APK does not keep the WhatsApp bot online.
