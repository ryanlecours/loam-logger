import { Expo } from 'expo-server-sdk';
import { config } from '../config/env';

export const expo = new Expo({
  accessToken: config.expoAccessToken,
});
