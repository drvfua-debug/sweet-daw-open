import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { SWEET_DAW_BUILD_INFO } from "@/generated/buildInfo";
import { UpdateGuard } from "@/ui/system/UpdateGuard";
import "./globals.css";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (process.env.NEXT_PUBLIC_STATIC_EXPORT === "true" ? "/lando_hp/sdaw" : "");
const basePath = rawBasePath.endsWith("/") ? rawBasePath.slice(0, -1) : rawBasePath;
const earlyChunkRecoveryScript = `
(function(){
  var key = "sweet-daw:early-chunk-recovery";
  function isChunkIssue(text){
    return /ChunkLoadError|Loading chunk|_next\\/static\\/chunks|Importing a module script failed|failed to fetch dynamically imported module/i.test(String(text || ""));
  }
  function recover(){
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch (_) {}
    var jobs = [];
    try {
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function(keys){ return Promise.all(keys.map(function(name){ return caches.delete(name); })); }));
      }
    } catch (_) {}
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function(regs){ return Promise.all(regs.map(function(reg){ return reg.unregister(); })); }));
      }
    } catch (_) {}
    Promise.allSettled(jobs).finally(function(){
      var url = new URL(window.location.href);
      url.searchParams.set("sdaw_recover", String(Date.now()));
      window.location.replace(url.toString());
    });
  }
  window.addEventListener("error", function(event){
    var text = [event && event.message, event && event.filename].join(" ");
    if (isChunkIssue(text)) {
      event.preventDefault();
      recover();
    }
  }, true);
  window.addEventListener("unhandledrejection", function(event){
    var reason = event && event.reason;
    var text = reason && reason.message ? reason.message : reason;
    if (isChunkIssue(text)) {
      event.preventDefault();
      recover();
    }
  });
})();
`;

export const metadata: Metadata = {
  title: "Sweet DAW",
  description: "Mobile browser DAW for importing stems, mixing, and exporting WAV from your phone.",
  manifest: `${basePath}/manifest.webmanifest?v=${encodeURIComponent(SWEET_DAW_BUILD_INFO.buildId)}`,
  icons: {
    icon: `${basePath}/icons/sweet-daw-icon.svg`,
    apple: `${basePath}/icons/sweet-daw-icon.svg`,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sweet DAW",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#080a0f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
        <meta name="sweet-daw-build" content={SWEET_DAW_BUILD_INFO.buildId} />
        <script dangerouslySetInnerHTML={{ __html: earlyChunkRecoveryScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ backgroundColor: "#080a0f", color: "#f4f7fb" }}>
        <UpdateGuard />
        {children}
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-HH619Z4PWC" strategy="afterInteractive" />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){window.dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-HH619Z4PWC');
          `}
        </Script>
      </body>
    </html>
  );
}
