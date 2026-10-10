import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/** Page HTML du favori web. Les balises « apple » font que l'iPhone l'ouvre en plein écran, comme une app. */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Scan3D" />
        <meta name="theme-color" content="#0b1220" />
        <link rel="manifest" href="manifest.json" />
        <link rel="apple-touch-icon" href="apple-touch-icon.png" />
        <ScrollViewStyleReset />
        <style>{'body { background-color: #0b1220; }'}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
