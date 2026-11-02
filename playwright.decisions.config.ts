import {defineConfig} from '@playwright/test';
/** Private fixed synthetic composition only; ordinary browser config is unchanged. */
export default defineConfig({
 testDir:'./test/decision-browser',testMatch:'decision-session.spec.ts',timeout:30_000,workers:1,fullyParallel:false,
 use:{ignoreHTTPSErrors:false,viewport:{width:1280,height:900}},
 webServer:{command:'node scripts/start-decision-ui-test-server.mjs',
  wait:{stdout:/CFHUB_FIXTURE_READY proxy=(?<CFHUB_PROXY_PORT>\d+) negative_proxy=(?<CFHUB_NEGATIVE_PROXY_PORT>\d+) app_port=(?<CFHUB_APP_PORT>\d+) app_pin=(?<CFHUB_APP_PIN>[A-Za-z0-9+/=]+) issuer_pin=(?<CFHUB_ISSUER_PIN>[A-Za-z0-9+/=]+) app_certificate=(?<CFHUB_APP_CERTIFICATE>[A-Za-z0-9+/=]+)/},
  timeout:60_000,reuseExistingServer:false,gracefulShutdown:{signal:'SIGTERM',timeout:10_000}}
});
