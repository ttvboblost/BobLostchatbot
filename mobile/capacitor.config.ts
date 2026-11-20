import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.boblost.chatbot',
  appName: 'BobLost Chatbot',
  webDir: '../artifacts/boblost-admin/dist/public',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
};

export default config;
