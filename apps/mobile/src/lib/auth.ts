import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_KEY = 'user';

export interface User {
  id: string;
  email?: string;
  name?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Platform-specific storage wrapper
 * Uses localStorage for web, SecureStore for native (iOS/Android)
 */
const storage = {
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  },

  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    } else {
      return await SecureStore.getItemAsync(key);
    }
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  },
};

export async function storeTokens(
  accessToken: string,
  refreshToken: string,
  user: User
): Promise<void> {
  await storage.setItem(ACCESS_TOKEN_KEY, accessToken);
  await storage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  await storage.setItem(USER_KEY, JSON.stringify(user));
}

export async function getAccessToken(): Promise<string | null> {
  return await storage.getItem(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return await storage.getItem(REFRESH_TOKEN_KEY);
}

export async function getStoredUser(): Promise<User | null> {
  const userJson = await storage.getItem(USER_KEY);
  return userJson ? JSON.parse(userJson) : null;
}

export async function clearTokens(): Promise<void> {
  await storage.removeItem(ACCESS_TOKEN_KEY);
  await storage.removeItem(REFRESH_TOKEN_KEY);
  await storage.removeItem(USER_KEY);
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

  try {
    const response = await fetch(`${apiUrl}/auth/mobile/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      await clearTokens();
      return null;
    }

    const data = await response.json();
    await storage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
    return data.accessToken;
  } catch (error) {
    console.error('Token refresh failed:', error);
    await clearTokens();
    return null;
  }
}

export async function loginWithEmail(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; errorType?: string }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

  try {
    const response = await fetch(`${apiUrl}/auth/mobile/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      let errorMessage = 'Login failed';
      let errorType = 'unknown';

      try {
        const error = await response.json();
        errorMessage = error.message || error.error || errorMessage;
      } catch {
        errorMessage = await response.text();
      }

      // Categorize error types based on status code and message
      if (response.status === 401) {
        if (errorMessage.includes('OAuth')) {
          errorType = 'oauth_only';
          errorMessage = 'This account uses OAuth login only. Please use Google or Apple sign-in.';
        } else {
          errorType = 'invalid_credentials';
          errorMessage = 'Invalid email or password. Please check your credentials and try again.';
        }
      } else if (response.status === 403 && errorMessage.includes('NOT_BETA_TESTER')) {
        errorType = 'not_beta';
        errorMessage = 'This app is currently in beta. Please contact support for access.';
      } else if (response.status === 400) {
        errorType = 'invalid_input';
      }

      return { success: false, error: errorMessage, errorType };
    }

    const data = await response.json();
    await storeTokens(data.accessToken, data.refreshToken, data.user);
    return { success: true };
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError && error.message === 'Network request failed') {
      return {
        success: false,
        error: 'Unable to connect to the server. Please check your internet connection and try again.',
        errorType: 'network',
      };
    }
    return { success: false, error: 'An unexpected error occurred. Please try again.', errorType: 'unknown' };
  }
}

export async function loginWithGoogle(
  idToken: string
): Promise<{ success: boolean; error?: string }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

  try {
    const response = await fetch(`${apiUrl}/auth/mobile/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Google login failed' };
    }

    const data = await response.json();
    await storeTokens(data.accessToken, data.refreshToken, data.user);
    return { success: true };
  } catch (_error) {
    return { success: false, error: 'Network error' };
  }
}

export async function loginWithApple(
  identityToken: string,
  user?: { email?: string; name?: { firstName?: string; lastName?: string } }
): Promise<{ success: boolean; error?: string }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

  try {
    const response = await fetch(`${apiUrl}/auth/mobile/apple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identityToken, user }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Apple login failed' };
    }

    const data = await response.json();
    await storeTokens(data.accessToken, data.refreshToken, data.user);
    return { success: true };
  } catch (_error) {
    return { success: false, error: 'Network error' };
  }
}

export async function logout(): Promise<void> {
  await clearTokens();
}
