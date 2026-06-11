import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.agentsense.cakewalk',
  appName: 'CakeWalk',
  webDir: 'dist',
  android: {
    backgroundColor: '#1a1208',
  },
  ios: {
    backgroundColor: '#1a1208',
    contentInset: 'never',
  },
};

export default config;
