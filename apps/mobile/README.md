# Loam Logger Mobile

React Native mobile app built with Expo Router for iOS and Android.

## Features

- **Authentication**: Email/password, Google Sign-In, Apple Sign-In
- **Expo Router**: File-based routing with tab navigation
- **Apollo Client**: GraphQL integration with bearer token auth
- **SecureStore**: Encrypted token storage
- **Shared Libraries**: Uses `@loam/graphql` and `@loam/shared` from monorepo

## Getting Started

### Prerequisites

- Node.js 20+
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (macOS only) or Android Studio

### Environment Variables

Create a `.env` file in `apps/mobile/`:

```env
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-google-client-id
```

For staging:
```env
EXPO_PUBLIC_API_URL=https://loam-api-staging.railway.app
```

### Development

From the **root directory**:

```bash
# Start the mobile dev server
npm run dev:mobile

# Or using Nx directly
nx start mobile
```

From the **mobile directory**:

```bash
cd apps/mobile

# Start with Expo Go
npm start

# Start on iOS simulator
npm run ios

# Start on Android emulator
npm run android
```

### Running on Device

1. Install Expo Go app on your device
2. Scan the QR code from the terminal
3. Make sure your device and computer are on the same network

### Project Structure

```
apps/mobile/
  app/
    (auth)/
      _layout.tsx      # Auth group layout
      login.tsx        # Login screen
      signup.tsx       # Sign up screen
    (tabs)/
      _layout.tsx      # Tab navigation
      index.tsx        # Rides screen
      gear.tsx         # Gear screen
      settings.tsx     # Settings screen
    _layout.tsx        # Root layout with auth check
  src/
    lib/
      apolloClient.ts  # Apollo Client config
      auth.ts          # Auth utilities with SecureStore
    hooks/
      useAuth.tsx      # Auth context hook
    components/        # Shared components
  app.json            # Expo configuration
  project.json        # Nx project configuration
```

## Authentication Flow

1. User opens app → Root layout checks for stored tokens
2. No tokens → Redirect to `/(auth)/login`
3. User logs in → Tokens stored in SecureStore
4. Redirect to `/(tabs)` (main app)
5. GraphQL requests use bearer token from SecureStore
6. On 401 error → Attempt token refresh
7. Refresh fails → Redirect to login

## Building for Production

### iOS

```bash
cd apps/mobile
expo build:ios
```

### Android

```bash
cd apps/mobile
expo build:android
```

## Notes

- The API URL in `.env` should point to your staging or local backend
- For production builds, update the API URL to your production backend
- Google Sign-In requires native configuration (see Expo docs)
- Apple Sign-In only works on real iOS devices (not simulator)
